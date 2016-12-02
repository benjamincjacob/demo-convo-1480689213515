/**
 * Copyright 2015 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var debug = require('debug')('bot:controller');
var extend = require('extend');
var Promise = require('bluebird');
var conversation = require('./api/conversation');
var weather = require('./api/weather');
var alchemyLanguage = require('./api/alchemy-language');
var cloudant = require('./api/cloudant');
var format = require('string-template');
var pick = require('object.pick');
var uuid = require('uuid');
var request = require('request');
var erp = require('./api/erp.js');

var sendMessageToConversation = Promise.promisify(conversation.message.bind(conversation));
var getUser = Promise.promisify(cloudant.get.bind(cloudant));
var saveUser = Promise.promisify(cloudant.put.bind(cloudant));
var saveLog = Promise.promisify(cloudant.putlog.bind(cloudant));
var extractEntities = Promise.promisify(alchemyLanguage.extractEntities.bind(alchemyLanguage));
var extractEmotion = Promise.promisify(alchemyLanguage.extractEmotion.bind(alchemyLanguage));
var getForecast = Promise.promisify(weather.forecastByGeoLocation.bind(weather));
var getGeoLocation = Promise.promisify(weather.geoLocation.bind(weather));
var getLoopLength = Promise.promisify(erp.getLoopLength.bind(erp));
var getLoopProfile = Promise.promisify(erp.getLoopProfile.bind(erp));
var getCurrentMRC = Promise.promisify(erp.getCurrentMRC.bind(erp));
var postOrder = Promise.promisify(erp.postOrder.bind(erp));
var getCustInfo = Promise.promisify(erp.getCustInfo.bind(erp));


module.exports = {
	/**
	 * Process messages from a channel and send a response to the user
	 * @param  {Object}   message.user  The user
	 * @param  {Object}   message.input The user meesage
	 * @param  {Object}   message.context The conversation context
	 * @param  {Function} callback The callback
	 * @return {void}
	 */
	processMessage: function(_message, source, callback) {
		var message = extend({
			input: {}
		}, _message);
		var input = message.text ? {
			text: message.text
		} : message.input;
		var user = message.user || message.from;

		debug('1. Process new message: %s.', JSON.stringify(message.input, null, 2));

		getUser(user).then(function(dbUser) {
			var smartchat = message.context ? message.context.smartchat : {};
			var context = dbUser ? dbUser.context : {};
			if (context.smartchat) {
				//context set from db
				debug('1. smartchat from db: %s', JSON.stringify(context.smartchat, null, 2));
			} else {
				context.smartchat = smartchat;
			}
			message.context = context;
			if (input.text == '') {
				input.text = 'test';
			}

			if (source == 'webui') {
				smartchat = {
					ATTUID: "BJ123A",
					ACDCat: "Install/Repair/Voice Support",
					BAN: "000000001",
					CUSTNAME: "John Smith",
					DISPATCHTYPE: "Install",
					TECHCBR: "2145555555",
					LEVEL1: "Package/Profile Change",
					//LEVEL1: "RG/STB Support",
					TRANSPORTTYPE: "FTTN",
				};
				message.context.smartchat = smartchat;
			}
			debug('1A. Message context added from db: %s.', JSON.stringify(message.context, null, 2));

			//checking for context variable alchemytext to potentially add to user input for alchemy call
			var alinput = JSON.parse(JSON.stringify(input));
			debug('1B. Params sent to alchemy: %s', JSON.stringify(input));

			//Sending input for emotion analysis
			return extractEmotion(alinput).then(function(alEmotion) {
					context.alEmotion = alEmotion;
				})
				.then(function() {
					if (message.context.api) {
						if (message.context.api.alchemytext != '') {
							alinput.text = message.context.api.alchemytext + input.text;
							debug('2. Adding alchemy context %s to input %s', message.context.api.alchemytext, input.text);
							// reset api alchemy pre text
							message.context.api.alchemytext = "";
						}
					}

					return extractEntities(alinput).then(function(alentity) {
						context.alentity = alentity;
					})
				})
				.then(function() {
					debug('4. Send message to Conversation.');
					return sendMessageToConversation(message);
				})


			.then(function(messageResponse) {
					debug('5. Conversation response: %s.', JSON.stringify(messageResponse, null, 2));

					var responseContext = messageResponse.context;
					if (responseContext.hasOwnProperty('api')) {
						//check if there is an api call to make
						switch (responseContext.api.RUN) {
							case 'LPA':
								//if (responseContext.api.RUN == 'LPA') {
								debug('Calling LPA API');
								var loop = '';
								//clear previous errors
								if (responseContext.api) {
									responseContext.api.LPAERROR = "";
								}

								return getCustInfo(responseContext.confirmed.BAN)
									.then(function(customer) {
										console.log("Customer info: %s", JSON.stringify(customer));
										responseContext.api.crm = {};
										extend(responseContext.api.crm, customer);

										return getLoopLength(responseContext.confirmed.BAN)
											.then(function(loopLength) {
												if (loopLength.ERROR) {
													responseContext.api.LPAERROR = loopLength.ERROR;
													delete responseContext.api.RUN;
													message = {
															input: messageResponse.input,
															context: responseContext
														}
														//.then(function() {
													debug('5A. Error send Conversation second send: %s.', JSON.stringify(message, null, 2));
													return sendMessageToConversation(message);
													//})
												} else {
													console.log("loop var is %s", JSON.stringify(loopLength));
													extend(responseContext.api, loopLength);
													console.log("api.loop is %s.", responseContext.api.LOOP);

													return getLoopProfile(responseContext.api.LOOP)
														.then(function(loopProfile) {
															console.log("profile var is %s", JSON.stringify(loopProfile));
															extend(responseContext.api, loopProfile);
															console.log("api profile is %s", responseContext.api.PROFILE);
															//check for tech change needed
															if (responseContext.api.crm) {
																var currSP = responseContext.api.crm.SERVICEPROFILE;
																if (currSP != '' && currSP.indexOf('dsl') > -1) {
																	responseContext.api.TECHCHANGE = 'YES';
																	responseContext.api.LPARESULT = "Accepted";
																} else {
																	//check if downgrade not allowed
																	var oldSpeed = currSP.slice(currSP.lastIndexOf("-"));
																	var newSpeed = responseContext.api.NewProfileID;
																	var newSpeed = newSpeed.slice(newSpeed.lastIndexOf("-"));
																	if (newSpeed >= oldSpeed) {
																		responseContext.api.LPARESULT = "Rejected.  Within guidelines.";
																	} else {
																		responseContext.api.LPARESULT = "Accepted";
																	}

																}
															}

															delete responseContext.api.RUN;
															message = {
																input: messageResponse.input,
																context: responseContext
															}

														})

													.then(function() {
														debug('5A. Conversation second send: %s.', JSON.stringify(message, null, 2));
														return sendMessageToConversation(message);
													})
												}

											})
									})



								break;
							case 'CRM':
								debug('Calling CRM');
								responseContext.api.OLDBILLAMT = "$55"; //setting default for testing
								responseContext.api.NEWBILLAMT = "$48"; //setting default for testing

								return getCurrentMRC(responseContext.confirmed.BAN)
									.then(function(CurMRC) {
										console.log("current mrc is %s", JSON.stringify(CurMRC));
										extend(responseContext.api, CurMRC);
										responseContext.api.OLDBILLAMT = responseContext.api.CurMRC;
										responseContext.api.NEWBILLAMT = responseContext.api.NewMRC;
										console.log("api.OLDBILLAMT is %s.", responseContext.api.OLDBILLAMT);
										delete responseContext.api.RUN;
										message = {
											input: messageResponse.input,
											context: responseContext
										}
									})

								.then(function() {
									debug('5A. Conversation second send: %s.', JSON.stringify(message, null, 2));
									return sendMessageToConversation(message);

								})

								break;
							case 'BBNMS':
								debug('calling BBNMS response');
								//responseContext.api.ORDNMBR = "2346771608A"; //setting default for testing
								var params = {
									ban: responseContext.confirmed.BAN,
									profile: responseContext.api.NewProfileName
								}
								return postOrder(params)
									.then(function(ORDNMBR) {
										console.log("ORDNMBR is %s", JSON.stringify(ORDNMBR));
										extend(responseContext.api, ORDNMBR);
										console.log("api.ORDNMBR is %s.", responseContext.api.ORDNMBR);
										delete responseContext.api.RUN;
										message = {
											input: messageResponse.input,
											context: responseContext
										}
									})

								.then(function() {
									debug('5A. Conversation second send: %s.', JSON.stringify(message, null, 2));
									return sendMessageToConversation(message);

								})

								break;
							default:
								return messageResponse;
						}

					} else {
						debug('5B. Conversation response to user: %s.', JSON.stringify(messageResponse, null, 2));
						return messageResponse;
					}
				})
				.then(function(messageResponse) {

					if (!messageResponse.context.get_weather) {
						//debug('6. Not enough information to search for forecast.');
						return messageResponse;
					}

				})
				//save whole message for chat logging
				.then(function(messageResponse) {
					debug('7. Save the message to chat log');
					saveLog(messageResponse);
					return (messageResponse);

				})


			.then(function(messageToUser) {
				debug('7. Save conversation context.');
				if (!dbUser) {
					dbUser = {
						_id: user
					};
				}
				debug('7. checked dbuser');
				dbUser.context = messageToUser.context;
				if (dbUser.context.api) {
					dbUser.context.api.RUN = "";
				}

				return saveUser(dbUser)
					.then(function(data) {
						debug('7. Send response to the user.');
						callback(null, messageToUser);
					});
			})
		})

		// Catch any issue we could have during all the steps above
		.catch(function(error) {
			debug(error);
			callback(error);
		});
	}
}