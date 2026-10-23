/* ================================================================
 * KumbhConnect — kc-native.js
 * Additive Capacitor bridge. Loaded AFTER the main inline scripts.
 *
 * What it does (native Android app only; the website/PWA is unchanged):
 *   - Location: replaces navigator.geolocation.getCurrentPosition with the
 *     Capacitor Geolocation plugin, after a plain-language explanation.
 *   - Camera:   "Take photo / choose from gallery" for the complaint form.
 *   - Share:    share the SOS / location text (Share plugin).
 *   - Haptics:  light feedback when the SOS sheet opens.
 *   - Push:     permission + registration + notification-tap navigation.
 *               Hidden until KC_NATIVE_CONFIG.pushConfigured === true.
 *
 * It never uploads anything, never tracks continuously, and never calls
 * anyone. Plugins are looked up with Capacitor.isPluginAvailable() so a
 * missing plugin degrades to the existing web behaviour instead of throwing.
 * ================================================================ */
(function () {
  'use strict';

  // ---- Owner-editable configuration -------------------------------------
  // Set pushConfigured:true ONLY after google-services.json is in
  // android/app/ and an FCM sender exists (see ANDROID-NATIVE-SETUP.md).
  var CFG = Object.assign({
    pushConfigured: false,
    // Optional: function(token){...} that sends the FCM token to a backend
    // YOU have configured. Left null: the token is not stored or sent.
    onPushToken: null
  }, window.KC_NATIVE_CONFIG || {});

  var MAX_PHOTO_BYTES = 5 * 1024 * 1024;               // same limit as the existing form
  var PHOTO_TYPES = /^data:image\/(jpeg|png|webp);base64,/i;
  var NAV_PAGES = ['home', 'explore', 'map', 'hire', 'sos', 'calendar', 'services', 'profile', 'kex'];

  // ---- Environment ------------------------------------------------------
  function cap() { return window.Capacitor || null; }
  function isNative() {
    var c = cap();
    try { return !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform()); }
    catch (e) { return false; }
  }
  function plugin(name) {
    var c = cap();
    if (!isNative() || !c) return null;
    try {
      if (typeof c.isPluginAvailable === 'function' && !c.isPluginAvailable(name)) return null;
      if (c.Plugins && c.Plugins[name]) return c.Plugins[name];
      if (typeof c.registerPlugin === 'function') return c.registerPlugin(name);
    } catch (e) { /* fall through */ }
    return null;
  }

  // ---- Text (Marathi default, English; other languages use English) ----
  var TX = {
    mr: {
      cont: 'पुढे जा', notnow: 'आता नको', close: 'बंद करा',
      loc_t: 'स्थान (Location) परवानगी',
      loc_b: 'नकाशावर तुमचे स्थान, जवळची ठिकाणे आणि SOS संदेशातील GPS दाखवण्यासाठी तुमचे सध्याचे स्थान एकदा वापरले जाईल. स्थान सतत ट्रॅक केले जात नाही आणि तुमच्या निवडीशिवाय कुठेही पाठवले जात नाही. नकार दिल्यास तुम्ही स्थान स्वतः निवडू शकता.',
      loc_denied: 'स्थान परवानगी बंद आहे. फोनच्या Settings मध्ये KumbhConnect साठी Location चालू करा किंवा स्थान स्वतः निवडा.',
      cam_t: 'फोटो जोडा',
      cam_b: 'तक्रारीसोबत फोटो जोडण्यासाठी कॅमेरा किंवा गॅलरी उघडली जाईल. फोटो आपोआप पाठवला जात नाही; तुम्ही तक्रार पाठवण्याचा पर्याय निवडेपर्यंत तो फक्त या फोनवर राहतो.',
      cam_btn: 'फोटो काढा / गॅलरीतून निवडा', cam_replace: 'फोटो बदला', cam_remove: 'फोटो काढून टाका',
      cam_denied: 'कॅमेरा/फोटो परवानगी मिळाली नाही. फोनच्या Settings मध्ये परवानगी द्या.',
      cam_cancel: 'फोटो निवड रद्द केली.',
      cam_type: 'फक्त JPEG, PNG किंवा WebP फोटो चालतील.',
      cam_size: 'फोटो ५ MB पेक्षा मोठा आहे. लहान फोटो निवडा.',
      cam_fail: 'फोटो मिळवता आला नाही. पुन्हा प्रयत्न करा.',
      cam_ok: 'फोटो निवडला. तक्रार पाठवण्यापूर्वी पूर्वावलोकन तपासा.',
      cam_removed: 'फोटो काढून टाकला.',
      share_btn: 'स्थान / संदेश शेअर करा',
      share_fail: 'शेअर करता आले नाही. "कॉपी करा" वापरा.',
      share_done: 'शेअर पर्याय उघडला. संदेश अजून कुणाला पोहोचला नाही — तुम्ही निवडलेल्या अ‍ॅपमधून पाठवा.',
      push_t: 'सूचना (Notifications)',
      push_b: 'कार्यक्रम आणि महत्त्वाच्या अपडेटच्या सूचना मिळवण्यासाठी परवानगी लागते. नकार दिला तरी अ‍ॅपचे इतर सर्व भाग वापरता येतात.',
      push_btn: 'सूचना चालू करा',
      push_denied: 'सूचना परवानगी बंद आहे. फोनच्या Settings मध्ये चालू करता येईल.',
      push_ok: 'या फोनची नोंदणी झाली. सूचना प्रत्यक्ष मिळण्यासाठी सर्व्हर बाजूची सेटअप आवश्यक आहे.',
      push_err: 'सूचना नोंदणी अयशस्वी झाली.',
      h_loc: 'माझे स्थान नकाशावर', h_loc_s: 'GPS वापरून किंवा हाताने निवडा',
      h_sos: 'आपत्कालीन मदत (SOS)', h_sos_s: 'स्थान, 112 कॉल आणि शेअर',
      h_rep: 'फोटोसह तक्रार', h_rep_s: 'कॅमेरा किंवा गॅलरी',
      h_title: 'अ‍ॅप सुविधा',
      sos_hint: 'SOS मधून आपोआप कॉल किंवा संदेश जात नाही; प्रत्येक पायरी तुम्ही निवडता.'
    },
    en: {
      cont: 'Continue', notnow: 'Not now', close: 'Close',
      loc_t: 'Location permission',
      loc_b: 'Your current location will be used once to show you on the map, find nearby places and add GPS to an SOS message. Location is not tracked continuously and is not sent anywhere unless you choose to send it. If you decline, you can pick your location manually.',
      loc_denied: 'Location permission is off. Enable Location for KumbhConnect in phone Settings, or choose your location manually.',
      cam_t: 'Attach a photo',
      cam_b: 'The camera or gallery will open so you can attach a photo to your complaint. The photo is not sent automatically; it stays on this phone until you choose to send the complaint.',
      cam_btn: 'Take photo / choose from gallery', cam_replace: 'Replace photo', cam_remove: 'Remove photo',
      cam_denied: 'Camera/photo permission was not granted. Allow it in phone Settings.',
      cam_cancel: 'Photo selection cancelled.',
      cam_type: 'Only JPEG, PNG or WebP photos are supported.',
      cam_size: 'The photo is larger than 5 MB. Choose a smaller one.',
      cam_fail: 'Could not get the photo. Please try again.',
      cam_ok: 'Photo selected. Check the preview before sending your complaint.',
      cam_removed: 'Photo removed.',
      share_btn: 'Share location / message',
      share_fail: 'Could not open Share. Use Copy instead.',
      share_done: 'Share sheet opened. Nothing has reached anyone yet — send it from the app you choose.',
      push_t: 'Notifications',
      push_b: 'Permission is needed to receive event and important-update notifications. If you decline, every other part of the app still works.',
      push_btn: 'Turn on notifications',
      push_denied: 'Notification permission is off. You can enable it in phone Settings.',
      push_ok: 'This phone is registered. Receiving notifications also needs server-side setup.',
      push_err: 'Notification registration failed.',
      h_loc: 'My location on the map', h_loc_s: 'Use GPS or pick manually',
      h_sos: 'Emergency help (SOS)', h_sos_s: 'Location, call 112, share',
      h_rep: 'Complaint with photo', h_rep_s: 'Camera or gallery',
      h_title: 'App tools',
      sos_hint: 'SOS never calls or sends a message by itself; you choose each step.'
    }
  };
  function lang() { try { return typeof _lang !== 'undefined' ? _lang : 'mr'; } catch (e) { return 'mr'; } }
  function t(k) { var d = TX[lang() === 'mr' ? 'mr' : 'en']; return d[k] !== undefined ? d[k] : TX.en[k] || ''; }
  function say(msg) { try { if (typeof toast === 'function') toast(msg); } catch (e) { /* no-op */ } }

  // ---- Accessible explanation dialog -------------------------------------
  var dlgOpen = null;
  function ask(titleKey, bodyKey, okKey) {
    if (dlgOpen) return dlgOpen;
    dlgOpen = new Promise(function (resolve) {
      var prev = document.activeElement;
      var wrap = document.createElement('div');
      wrap.className = 'kcn-ov';
      wrap.innerHTML =
        '<div class="kcn-dlg" role="dialog" aria-modal="true" aria-labelledby="kcn-t" aria-describedby="kcn-b">' +
        '<h3 id="kcn-t"></h3><p id="kcn-b"></p>' +
        '<div class="kcn-row"><button type="button" class="kcn-no"></button><button type="button" class="kcn-ok"></button></div></div>';
      wrap.querySelector('#kcn-t').textContent = t(titleKey);
      wrap.querySelector('#kcn-b').textContent = t(bodyKey);
      var ok = wrap.querySelector('.kcn-ok'), no = wrap.querySelector('.kcn-no');
      ok.textContent = t(okKey || 'cont'); no.textContent = t('notnow');
      function done(v) {
        document.removeEventListener('keydown', onKey, true);
        wrap.remove(); dlgOpen = null;
        try { if (prev && prev.focus) prev.focus(); } catch (e) { /* no-op */ }
        resolve(v);
      }
      function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); done(false); } }
      ok.addEventListener('click', function () { done(true); });
      no.addEventListener('click', function () { done(false); });
      wrap.addEventListener('click', function (e) { if (e.target === wrap) done(false); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(wrap);
      ok.focus();
    });
    return dlgOpen;
  }

  // ---- Haptics -----------------------------------------------------------
  function haptic(kind) {
    var H = plugin('Haptics');
    if (!H) return;
    try {
      if (kind === 'warn' && H.notification) H.notification({ type: 'WARNING' });
      else if (H.impact) H.impact({ style: 'MEDIUM' });
    } catch (e) { /* haptics are optional */ }
  }

  // ---- Location ----------------------------------------------------------
  var G = null, locGranted = false, locAsk = null;
  function geoOK(s) { return s && (s.location === 'granted' || s.coarseLocation === 'granted'); }

  function ensureLocation() {
    if (locGranted) return Promise.resolve(true);
    if (locAsk) return locAsk;
    locAsk = (async function () {
      try {
        var s = await G.checkPermissions();
        if (geoOK(s)) { locGranted = true; return true; }
        if (s.location === 'denied') { say(t('loc_denied')); return false; }
        var go = await ask('loc_t', 'loc_b');                  // explain BEFORE the system prompt
        if (!go) return false;
        s = await G.requestPermissions({ permissions: ['location'] });
        locGranted = !!geoOK(s);
        if (!locGranted) say(t('loc_denied'));
        return locGranted;
      } catch (e) { return false; }
      finally { locAsk = null; }
    })();
    return locAsk;
  }

  function installGeolocation() {
    G = plugin('Geolocation');
    if (!G || !navigator.geolocation) return;               // browser/PWA or plugin missing: leave web API alone
    G.checkPermissions().then(function (s) { locGranted = !!geoOK(s); }).catch(function () {});
    var orig = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    function getCurrentPosition(ok, fail, opts) {
      opts = opts || {};
      function bad(code, msg) { if (typeof fail === 'function') fail({ code: code, message: msg, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); }
      ensureLocation().then(function (allowed) {
        if (!allowed) return bad(1, 'Location permission not granted');
        return G.getCurrentPosition({
          enableHighAccuracy: !!opts.enableHighAccuracy,
          timeout: opts.timeout || 10000,
          maximumAge: opts.maximumAge || 0
        }).then(function (p) { if (typeof ok === 'function') ok(p); },
          function (e) {
            var m = String((e && e.message) || e || '');
            bad(/timeout/i.test(m) ? 3 : /denied|permission/i.test(m) ? 1 : 2, m);
          });
      }).catch(function () {
        // Plugin unusable for some reason: fall back to the WebView API rather than failing silently.
        try { orig(ok, fail, opts); } catch (e) { bad(2, 'Location unavailable'); }
      });
    }
    try { navigator.geolocation.getCurrentPosition = getCurrentPosition; }
    catch (e) {
      try { Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { value: getCurrentPosition, configurable: true }); } catch (e2) { /* keep web API */ }
    }
  }
  // Pages may auto-detect landmarks only if permission is already granted (no surprise prompts).
  function mayAutoLocate() { return !G || locGranted; }

  // ---- Camera ------------------------------------------------------------
  var camAsked = false;
  function approxBytes(dataUrl) {
    var i = dataUrl.indexOf(',');
    return Math.floor((dataUrl.length - i - 1) * 3 / 4);
  }
  async function pickPhoto() {
    var C = plugin('Camera');
    if (!C) { var inp = document.getElementById('sos-photo-input'); if (inp) inp.click(); return; }
    if (!camAsked) {
      var go = await ask('cam_t', 'cam_b');
      if (!go) return;
      camAsked = true;
    }
    try {
      var photo = await C.getPhoto({
        quality: 80, width: 1600, correctOrientation: true, allowEditing: false,
        saveToGallery: false, resultType: 'dataUrl', source: 'PROMPT'
      });
      var url = photo && photo.dataUrl;
      if (!url || !PHOTO_TYPES.test(url)) { say(t('cam_type')); return; }
      if (approxBytes(url) > MAX_PHOTO_BYTES) { say(t('cam_size')); return; }
      if (!applyPhoto(url)) { say(t('cam_fail')); return; }
      url = null; photo = null;                                // drop local references; the form holds the one copy
      refreshPhotoUi(); say(t('cam_ok'));
    } catch (e) {
      var m = String((e && e.message) || e || '');
      if (/cancel/i.test(m)) say(t('cam_cancel'));
      else if (/denied|permission/i.test(m)) say(t('cam_denied'));
      else say(t('cam_fail'));
    }
  }
  // index.html keeps the pending complaint photo in the page-level `_sosPhoto` and shows it in #sos-photo-preview
  // (same as handlePhotoUpload). It has no kcApplySosPhoto/kcClearSosPhoto helpers, so set that state here.
  function applyPhoto(url) {
    try { _sosPhoto = url; } catch (e) { return false; }
    var pv = document.getElementById('sos-photo-preview');
    if (pv) { pv.src = url; pv.style.display = 'block'; }
    return true;
  }
  function clearPhoto() {
    try { _sosPhoto = null; } catch (e) { /* page state not available */ }
    var pv = document.getElementById('sos-photo-preview');
    if (pv) { pv.src = ''; pv.style.display = 'none'; }
  }
  function removePhoto() {
    clearPhoto();
    var inp = document.getElementById('sos-photo-input'); if (inp) inp.value = '';
    refreshPhotoUi(); say(t('cam_removed'));
  }
  function hasPhoto() { try { return !!_sosPhoto; } catch (e) { return false; } }
  function refreshPhotoUi() {
    var b = document.getElementById('kcn-cam-btn'), r = document.getElementById('kcn-cam-rm');
    if (b) b.textContent = hasPhoto() ? t('cam_replace') : t('cam_btn');
    if (r) { r.hidden = !hasPhoto(); r.textContent = t('cam_remove'); }
  }
  function mountPhotoControls() {
    var inp = document.getElementById('sos-photo-input');
    if (!inp || document.getElementById('kcn-photo')) return;
    var box = document.createElement('div');
    box.id = 'kcn-photo'; box.className = 'kcn-photo';
    box.innerHTML =
      '<button type="button" id="kcn-cam-btn" class="kcn-btn"></button>' +
      '<button type="button" id="kcn-cam-rm" class="kcn-btn kcn-ghost" hidden></button>';
    inp.parentNode.insertBefore(box, inp);
    if (isNative() && plugin('Camera')) document.documentElement.classList.add('kc-native-cam');
    box.querySelector('#kcn-cam-btn').addEventListener('click', pickPhoto);
    box.querySelector('#kcn-cam-rm').addEventListener('click', removePhoto);
    refreshPhotoUi();
  }

  // ---- Share -------------------------------------------------------------
  async function shareText(text, title) {
    var S = plugin('Share');
    try {
      if (S) { await S.share({ title: title || 'KumbhConnect', text: text, dialogTitle: title || 'KumbhConnect' }); return 'ok'; }
      if (navigator.share) { await navigator.share({ title: title || 'KumbhConnect', text: text }); return 'ok'; }
      return 'unsupported';
    } catch (e) {
      return /cancel|abort/i.test(String((e && (e.message || e.name)) || '')) ? 'cancelled' : 'error';
    }
  }
  async function shareSos() {
    var st = document.getElementById('sosx-copy-status');
    var msg = null; try { msg = _sosx && _sosx.msg; } catch (e) { /* none */ }
    if (!msg) return;
    var r = await shareText(msg, 'KumbhConnect SOS');
    if (st) st.textContent = r === 'ok' ? t('share_done') : r === 'cancelled' ? '' : t('share_fail');
  }
  function canShare() { return !!(plugin('Share') || navigator.share); }

  // ---- Push --------------------------------------------------------------
  var pushWired = false;
  function pushAvailable() { return isNative() && CFG.pushConfigured === true && !!plugin('PushNotifications'); }
  function wirePush(P) {
    if (pushWired) return; pushWired = true;
    P.addListener('registration', function (tok) {
      // The token is NOT stored, logged or sent unless the owner supplies onPushToken.
      try { if (typeof CFG.onPushToken === 'function' && tok && tok.value) CFG.onPushToken(tok.value); } catch (e) { /* owner hook */ }
      say(t('push_ok'));
    });
    P.addListener('registrationError', function () { say(t('push_err')); });
    P.addListener('pushNotificationActionPerformed', function (ev) {
      var d = ev && ev.notification && ev.notification.data;
      var pg = d && typeof d.page === 'string' ? d.page : '';
      if (NAV_PAGES.indexOf(pg) !== -1 && typeof nav === 'function') nav(pg);   // whitelist only; no arbitrary URLs
    });
  }
  async function enablePush() {
    var P = plugin('PushNotifications');
    if (!pushAvailable() || !P) return;
    try {
      var s = await P.checkPermissions();
      if (s.receive === 'denied') { say(t('push_denied')); return; }
      if (s.receive !== 'granted') {
        var go = await ask('push_t', 'push_b');
        if (!go) return;
        s = await P.requestPermissions();
        if (s.receive !== 'granted') { say(t('push_denied')); return; }
      }
      wirePush(P);
      await P.register();
    } catch (e) { say(t('push_err')); }
  }

  // ---- Home tools card ---------------------------------------------------
  function openMyLocation() {
    if (typeof nav === 'function') nav('map');
    setTimeout(function () { if (typeof myLocation === 'function') myLocation(); }, 400);
  }
  function openComplaintPhoto() {
    if (typeof nav === 'function') nav('sos');
    setTimeout(function () {
      var el = document.getElementById('kcn-photo') || document.getElementById('griev');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    }, 300);
  }
  function renderHome() {
    var qgrid = document.querySelector('#pg-home .qgrid');
    if (!qgrid) return;
    var host = document.getElementById('kcn-home');
    if (!host) {
      host = document.createElement('section');
      host.id = 'kcn-home'; host.className = 'kcn-home';
      qgrid.parentNode.appendChild(host);
    }
    var items = [
      { id: 'loc', cls: '', ico: '\uD83D\uDCCD', a: t('h_loc'), b: t('h_loc_s'), fn: openMyLocation },
      { id: 'sos', cls: 'kcn-sos', ico: '\uD83C\uDD98', a: t('h_sos'), b: t('h_sos_s'), fn: function () { if (typeof nav === 'function') nav('sos'); } },
      { id: 'rep', cls: '', ico: '\uD83D\uDCF7', a: t('h_rep'), b: t('h_rep_s'), fn: openComplaintPhoto }
    ];
    if (pushAvailable()) items.push({ id: 'push', cls: '', ico: '\uD83D\uDD14', a: t('push_btn'), b: t('push_t'), fn: enablePush });
    host.textContent = '';
    var h = document.createElement('div'); h.className = 'kcn-h'; h.textContent = t('h_title'); host.appendChild(h);
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'kcn-card ' + it.cls;
      var i = document.createElement('span'); i.className = 'kcn-i'; i.setAttribute('aria-hidden', 'true'); i.textContent = it.ico;
      var tx = document.createElement('span'); tx.className = 'kcn-tx';
      var a = document.createElement('b'); a.textContent = it.a;
      var s = document.createElement('small'); s.textContent = it.b;
      tx.appendChild(a); tx.appendChild(s); b.appendChild(i); b.appendChild(tx);
      b.addEventListener('click', it.fn);
      host.appendChild(b);
    });
    var hint = document.createElement('p'); hint.className = 'kcn-hint'; hint.textContent = t('sos_hint'); host.appendChild(hint);
  }

  // ---- Boot --------------------------------------------------------------
  function patchSetLang() {
    if (typeof window.setLang !== 'function' || window.setLang.__kcn) return;
    var orig = window.setLang;
    var w = function () { var r = orig.apply(this, arguments); try { renderHome(); refreshPhotoUi(); } catch (e) { /* no-op */ } return r; };
    w.__kcn = true; window.setLang = w;
  }
  function init() {
    if (isNative()) document.documentElement.classList.add('kc-native');
    installGeolocation();
    mountPhotoControls();
    renderHome();
    patchSetLang();
  }

  window.KCNative = {
    isNative: isNative, t: t, haptic: haptic, canShare: canShare, shareSos: shareSos,
    shareText: shareText, mayAutoLocate: mayAutoLocate, pickPhoto: pickPhoto, removePhoto: removePhoto,
    enablePush: enablePush, refreshPhotoUi: refreshPhotoUi
  };

  // Capacitor injects window.Capacitor before page scripts on Android; init after DOM is ready.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
