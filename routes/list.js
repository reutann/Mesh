var express = require('express');
var router = express.Router();
var moment = require('moment');
var async = require('async');
var echo = require('echojs')({
    key: process.env.ECHONEST_KEY
});
var LastFmNode = require('lastfm').LastFmNode;
var lastfm = new LastFmNode({
    api_key:  process.env.LASTFM_KEY,
    secret: process.env.LASTFM_SECRET,
    useragent: 'Mesh'
});
var freq = 14;

function translate(req, res, next) {
    if (typeof req.params.of !== 'undefined' && req.params.of.slice(-5) == '.opml')
        req.query.key = req.params.of.slice(0, -5);
    next(null, req, res);
}

router.get('/stations/:of?', translate, require('../user/isAuthenticated'), function(req, res) {
    var data = [];
    var getInfo = function(station, done) {
        var subdata = {
            name: station.prettyName,
            id: station.index
        };

        var next = function(station) {
            if (typeof station.image === 'undefined') station.image = '/img/noAlbum.png';
            //TODO: better noAlbum image (dynamic)
            data.push(subdata);
            req.user.markModified('stations');
            req.user.save(function() {
                done(null);
            });
        };

        if (moment(station.timestamp, 'MM-DD-YYYY').diff(moment(), 'days') < (1 - freq) || !station.bootstrapped) {
            station.bootstrapped = true;
            echo('tasteprofile/read').get({
                bucket: 'images',
                id: station.id
            }, function(err, json) {
                var favItem;
                station.timestamp = moment().format('MM-DD-YYYY');
                if (typeof json.response.catalog === 'undefined') {
                    return next(station);
                }
                for (var i in json.response.catalog.items) {
                    var item = json.response.catalog.items[i];
                    if (item.favorite) {
                        favItem = item;
                        break;
                    }
                }
                if (typeof favItem === 'undefined') return next(station);
                if (typeof favItem.song_id !== 'undefined') {
                    lastfm.request('track.getInfo', {
                        artist: favItem.artist_name,
                        track: favItem.song_name,
                        handlers: {
                            success: function(lfmData) {
                                if (typeof lfmData.track.album.image !== 'undefined')
                                    subdata.image = station.image = lfmData.track.album.image[lfmData.track.album.image.length - 1]['#text'];
                                next(station);
                            },
                            error: function(lfmData) {
                                next(station);
                            }
                        }
                    });
                } else {
                    if (favItem.images.length)
                        subdata.image = station.image = favItem.images[0].url;
                    return next(station);
                }
            });
        } else {
            subdata.image = station.image;
            next(station);
        }
    };

    if (typeof req.params.of !== 'undefined' && req.params.of.slice(-5) != '.opml') {
        if (req.params.of >= req.user.stations.length)  return res.status(400).end("Station index out of range.");
        getInfo(req.user.stations[req.params.of], function() {
            res.end(JSON.stringify(data[0]));
        });
    } else {
        async.each(req.user.stations, getInfo, function(err) {
            if (typeof req.params.of !== 'undefined' && req.params.of.slice(-5) == '.opml') {
                res.render('squeezebox', {
                    stations: data,
                    url: process.env.URL,
                    key: req.query.key
                });
            } else {
                var orderedData = [];
                for (var i in data) {
                    orderedData[parseInt(req.user.order[i])] = data[i];
                }
                res.end(JSON.stringify({
                    stations: orderedData,
                    lastStation: req.user.lastStation
                }));
            }
        });
    }
});

module.exports = router;
