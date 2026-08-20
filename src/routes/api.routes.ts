import { Router } from 'express';


const router = Router();
import { requireAuth } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimit';

const globalLimiter = rateLimiter({ limit: 60, windowMs: 60_000, keyPrefix: 'global:ip' });
const identifyLimiter = rateLimiter({ limit: 10, windowMs: 60_000, keyPrefix: 'identify:ip' });
const romanizeLimiter = rateLimiter({ limit: 30, windowMs: 60_000, keyPrefix: 'romanize:ip' });
const uploadLimiter = rateLimiter({ limit: 5, windowMs: 60_000, keyPrefix: 'upload:ip' });
const lyricsLimiter = rateLimiter({ limit: 30, windowMs: 60_000, keyPrefix: 'lyrics:ip' });
const searchLimiter = rateLimiter({ limit: 30, windowMs: 60_000, keyPrefix: 'search:ip' });
const tracksLimiter = rateLimiter({ limit: 50, windowMs: 60_000, keyPrefix: 'tracks:ip' });
const scrapeLimiter = rateLimiter({ limit: 10, windowMs: 60_000, keyPrefix: 'scrape:ip' });
const proxyLimiter = rateLimiter({ limit: 20, windowMs: 60_000, keyPrefix: 'proxy:ip' });

// Apply global rate limit to all routes in this router
router.use(globalLimiter);

// Discover
import * as ai_discoverController from '../controllers/discover/ai_discover.controller';
router.post('/ai/discover', requireAuth, ai_discoverController.postAiDiscover);
router.get('/ai/discover', requireAuth, ai_discoverController.getAiDiscover);
import * as cron_discoverController from '../controllers/discover/cron_discover.controller';
router.get('/cron/discover', cron_discoverController.getCronDiscover);

// Albums
import * as albums_idController from '../controllers/albums/albums_id.controller';
router.get('/albums/:id', albums_idController.getAlbumsId);

// Artists
import * as artists_id_albumsController from '../controllers/artists/artists_id_albums.controller';
router.get('/artists/:id/albums', artists_id_albumsController.getArtistsIdAlbums);
import * as artists_idController from '../controllers/artists/artists_id.controller';
router.get('/artists/:id', artists_idController.getArtistsId);
import * as artists_id_topController from '../controllers/artists/artists_id_top.controller';
router.get('/artists/:id/top', artists_id_topController.getArtistsIdTop);

// Auth
import * as auth_spotify_callbackController from '../controllers/auth/auth_spotify_callback.controller';
router.get('/auth/spotify/callback', auth_spotify_callbackController.getAuthSpotifyCallback);
import * as auth_spotify_loginController from '../controllers/auth/auth_spotify_login.controller';
router.get('/auth/spotify/login', auth_spotify_loginController.getAuthSpotifyLogin);

// Import
import * as import_scrapeController from '../controllers/import/import_scrape.controller';
router.post('/import/scrape', scrapeLimiter, requireAuth, import_scrapeController.postImportScrape);

import * as import_processController from '../controllers/import/import_process.controller';
router.post('/import/process', requireAuth, import_processController.postImportProcess);

import * as import_cancelController from '../controllers/import/import_cancel.controller';
router.post('/import/cancel', requireAuth, import_cancelController.postImportCancel);

// Playlists
import * as playlistsController from '../controllers/playlists/playlists.controller';
router.post('/playlists', requireAuth, playlistsController.postPlaylists);
import * as playlists_idController from '../controllers/playlists/playlists_id.controller';
router.put('/playlists/:id', requireAuth, playlists_idController.putPlaylistsId);

// Radio
import * as radio_metadataController from '../controllers/radio/radio_metadata.controller';
router.get('/radio/metadata', radio_metadataController.getRadioMetadata);
import * as radio_proxyController from '../controllers/radio/radio_proxy.controller';
router.get('/radio/proxy', radio_proxyController.getRadioProxy);

// Search
import * as search_albumsController from '../controllers/search/search_albums.controller';
router.get('/search/albums', searchLimiter, search_albumsController.getSearchAlbums);
import * as search_artistsController from '../controllers/search/search_artists.controller';
router.get('/search/artists', searchLimiter, search_artistsController.getSearchArtists);
import * as searchController from '../controllers/search/search.controller';
router.get('/search', searchLimiter, searchController.getSearch);
import * as search_songsController from '../controllers/search/search_songs.controller';
router.get('/search/songs', searchLimiter, search_songsController.getSearchSongs);


// Tracks
import * as tracks_batchController from '../controllers/tracks/tracks_batch.controller';
router.post('/tracks/batch', tracksLimiter, tracks_batchController.postTracksBatch);
import * as tracks_idController from '../controllers/tracks/tracks_id.controller';
router.get('/tracks/:id', tracksLimiter, tracks_idController.getTracksId);
import * as tracks_id_similarController from '../controllers/tracks/tracks_id_similar.controller';
router.get('/tracks/:id/similar', tracksLimiter, tracks_id_similarController.getTracksIdSimilar);

// Users

// Misc
import * as homeController from '../controllers/misc/home.controller';
router.get('/home', homeController.getHome);
import * as identifyController from '../controllers/misc/identify.controller';
router.post('/identify', identifyLimiter, requireAuth, identifyController.postIdentify);
import * as lyricsController from '../controllers/misc/lyrics.controller';
router.get('/lyrics', lyricsLimiter, lyricsController.getLyrics);
import * as previewController from '../controllers/misc/preview.controller';
router.get('/preview', previewController.getPreview);
import * as proxyController from '../controllers/misc/proxy.controller';
router.get('/proxy', proxyLimiter, proxyController.getProxy);
import * as romanizeController from '../controllers/misc/romanize.controller';
router.post('/romanize', romanizeLimiter, requireAuth, romanizeController.postRomanize);
import * as uploadController from '../controllers/misc/upload.controller';
router.post('/upload/presign', uploadLimiter, requireAuth, uploadController.postPresign);
router.post('/upload/verify', uploadLimiter, requireAuth, uploadController.postVerify);
import * as socialController from '../controllers/misc/social.controller';
router.get('/social', requireAuth, socialController.getSocialFeed);

export default router;
