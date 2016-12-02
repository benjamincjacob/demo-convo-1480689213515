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

var watson = require('watson-developer-cloud');
var alchemyLanguage = watson.alchemy_language({
	api_key: process.env.ALCHEMY_API_KEY
});
/*
var AlchemyLanguageV1 = require('watson-developer-cloud/alchemy-language/v1');
var alchemyLanguage = new AlchemyLanguageV1({
	api_key: process.env.ALCHEMY_API_KEY
});
*/
var debug = require('debug')('bot:api:alchemy-language');

/**
 * Returns true if the entity.type is a city
 * @param  {Object}  entity Alchemy entity
 * @return {Boolean}        True if entity.type is a city
 */
function isCity(entity) {
	return entity.type === 'City';
}

/**
 * Returns only the name property
 * @param  {Object}  entity Alchemy entity
 * @return {Object}  Only the name property
 */
function onlyName(entity) {
	return {
		name: entity.text
	};
}

/**
 * Returns only the entity property
 * @param  {Object}  entity Alchemy entity
 * @return {Object}  Only the name property
 */
function cleanResult(entity) {
	var name = entity.type;
	return {
		[name]: entity.text
	};
}

function sentimentResult(entity) {
	if (entity.sentiment) {
		return {
			sentimentType: entity.sentiment.type,
			sentimentScore: entity.sentiment.score
		}
	} else
		return {}
}

module.exports = {
	/**
	 * Extract the city mentioned in the input text
	 * @param  {Object}   params.text  The text
	 * @param  {Function} callback The callback
	 * @return {void}
	 */
	/*
	extractCity: function(params, callback) {
	  params.language = 'english';
	  params.model = process.env.ALCHEMY_MODEL;
	  alchemyLanguage.entities(params, function(err, response) {
	    debug('text: %s, entities: %s', params.text, JSON.stringify(response.entities));
	    if (err) {
	      callback(err);
	    }
	    else {
	      var cities = response.entities.filter(isCity).map(onlyName);
	      callback(null, cities.length > 0 ? cities[0]: null);
	    }
	  })
	}
	*/
	extractEntities: function(params, callback) {
		params.language = 'english';
		params.model = process.env.ALCHEMY_MODEL;
		params.sentiment = 1;
		params.emotion = 1;
		//params.model = 'en-news';
		alchemyLanguage.entities(params, function(err, response) {
			if (response && response.entities) {
				debug('text: %s, entities: %s', params.text, JSON.stringify(response.entities));
			}
			if (err) {
				//callback(err);
				debug('error is %s', err.message);
				debug('error is %s', JSON.stringify(err));
				callback(null, {
					'error': err.message
				});
			} else {
				var result = {};
				var results = response.entities.map(cleanResult);
				if (results.length > 0) {
					debug('number in array is %s', results.length);
					for (var i = 0; i < results.length; ++i) {
						for (var propertyName in results[i]) {
							result[propertyName] = results[i][propertyName];
						}

					}
				}
				var sentiments = response.entities.map(sentimentResult);
				if (sentiments.length > 0) {
					debug('Sentiment Result is %s', JSON.stringify(sentiments));
				}

				callback(null, result);
			}
		})
	},

	extractEmotion: function(params, callback) {
		alchemyLanguage.emotion(params, function (err, response) {
			if (response && response.docEmotions) {
				debug('text: %s, docEmotions: %s', params.text, JSON.stringify(response.docEmotions));
			}
			if (err) {
				//callback(err);
				debug('error is %s', err.message);
				debug('error is %s', JSON.stringify(err));
				callback(null, {
					'error': err.message
				});
			} else {
				/*
				var result = {};
				var results = response.entities.map(cleanResult);
				if (results.length > 0) {
					debug('number in array is %s', results.length);
					for (var i = 0; i < results.length; ++i) {
						for (var propertyName in results[i]) {
							result[propertyName] = results[i][propertyName];
						}

					}
				}
				var sentiments = response.entities.map(sentimentResult);
				if (sentiments.length > 0) {
					debug('Sentiment Result is %s', JSON.stringify(sentiments));
				}
*/
				callback(null, response.docEmotions);
			}
		})
	}
};