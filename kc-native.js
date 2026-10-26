/*
 * KumbhConnect Native Android bridge — release candidate (v2)
 * File: kc-native.js
 * Additive integration for Capacitor WebView. Push remains opt-in/off by default.
 * Requires matching Capacitor plugins to be installed and synced in Android.
 * This file alone does not certify Play Store / Indus Appstore policy or build readiness.
 */
/* ================================================================
 * KumbhConnect — kc-native.js
 * Additive Capacitor bridge. Loaded AFTER the main inline scripts.
 *
 * Native Android app only; the website/PWA is unchanged.
 *   - Location:  Capacitor Geolocation behind navigator.geolocation, after an explanation.
 *   - Camera:    "Take photo / choose from gallery" for the complaint form.
 *   - Share:     share SOS text and share the app (Share plugin).
 *   - Haptics:   feedback when SOS is opened.
 *   - Push:      permission + registration + tap navigation (hidden until pushConfigured:true).
 *   NEW in v2
 *   - Offline banner (Network plugin; falls back to online/offline events).
 *   - Personal reminders (Local Notifications): user-chosen name + date/time, fully on-device.
 *   - Nearby places (needs KC_NATIVE_CONFIG.places; sorted by distance from one GPS fix).
 *   - Share the app.
 *   - Android Back: closes the top dialog first, then returns to Home, then double-press to exit.
 *   - Fixes: StatusBar style and Keyboard resize mode now use string values (the plugin
 *     enums are not available without a bundler, so v1 silently skipped them).
 *
 * It never uploads anything, never tracks continuously, and never calls anyone.
 * Plugins are looked up with Capacitor.isPluginAvailable() so a missing plugin
 * degrades to the existing web behaviour instead of throwing.
 * ================================================================ */
(function () {
  'use strict';

  // ---- Owner-editable configuration -------------------------------------
  // Set before this script loads, e.g.:
  //   <script>window.KC_NATIVE_CONFIG = { pushConfigured: true, places: [ {name:'...', lat:0, lng:0, note:'...'} ] };</script>
  // pushConfigured:true ONLY after google-services.json is in android/app/ and FCM is set up.
  var CFG = Object.assign({
    pushConfigured: false,
    // Optional: function(token){...} that sends the FCM token to a backend YOU configured.
    // Left null: the token is not stored or sent.
    onPushToken: null,
    // Optional override for the "Nearby places" card: [{ name, lat, lng, note?, type?, icon? }].
    // Empty = use the app's own LOCS list.
    places: [],
    // Link included when the user taps "Share app".
    shareUrl: 'https://kumbhmelaconnect-maker.github.io/Kumbhconnect-/'
  }, window.KC_NATIVE_CONFIG || {});

  var MAX_PHOTO_BYTES = 5 * 1024 * 1024;               // same limit as the existing form
  var PHOTO_TYPES = /^data:image\/(jpeg|png|webp);base64,/i;
  var NAV_PAGES = ['home', 'explore', 'map', 'hire', 'sos', 'calendar', 'services', 'profile', 'kex'];
  var nativeWired = false;
  var lastBackAt = 0;
  var BACK_EXIT_WINDOW_MS = 1800;
  var activeClose = null;                               // closes the top-most dialog/sheet (used by Back)

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
  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
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
      sos_hint: 'SOS मधून आपोआप कॉल किंवा संदेश जात नाही; प्रत्येक पायरी तुम्ही निवडता.',
      back_exit: 'अ‍ॅप बंद करण्यासाठी पुन्हा Back दाबा.',
      // v2
      off: 'इंटरनेट नाही — काही सुविधा मर्यादित आहेत',
      rem_card: 'आठवण सेट करा', rem_card_s: 'निवडलेल्या वेळी फोनवर सूचना',
      rem_t: 'आठवण (Reminder)',
      rem_b: 'तुम्ही निवडलेल्या वेळी आठवण दाखवण्यासाठी सूचना परवानगी लागते. आठवणी फक्त या फोनवर राहतात; काहीही सर्व्हरवर पाठवले जात नाही.',
      rem_name: 'आठवणीचे नाव', rem_when: 'दिनांक व वेळ', rem_save: 'आठवण जतन करा',
      rem_list: 'सेट केलेल्या आठवणी', rem_none: 'अजून आठवण नाही', rem_del: 'रद्द करा',
      rem_ok: 'आठवण सेट झाली.', rem_past: 'भविष्यातील दिनांक व वेळ निवडा.', rem_noname: 'आठवणीला नाव द्या.',
      rem_denied: 'सूचना परवानगी बंद आहे. फोनच्या Settings मध्ये चालू करा.',
      rem_unavail: 'आठवण सुविधा या डिव्हाइसवर उपलब्ध नाही.',
      rem_fail: 'आठवण सेट करता आली नाही. पुन्हा प्रयत्न करा.',
      rem_body: 'KumbhConnect आठवण',
      app_card: 'अ‍ॅप शेअर करा', app_card_s: 'मित्र-कुटुंबाला पाठवा',
      app_msg: 'KumbhConnect – नाशिक कुंभमेळा मार्गदर्शक',
      near_card: 'जवळची ठिकाणे', near_card_s: 'तुमच्या स्थानापासून अंतरानुसार',
      near_t: 'जवळची ठिकाणे', near_none: 'जवळची ठिकाणे दाखवता आली नाहीत.',
      near_wait: 'स्थान शोधत आहे…'
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
      sos_hint: 'SOS never calls or sends a message by itself; you choose each step.',
      back_exit: 'Press Back again to exit the app.',
      // v2
      off: 'You are offline — some features are limited',
      rem_card: 'Set a reminder', rem_card_s: 'Phone alert at a time you choose',
      rem_t: 'Reminder',
      rem_b: 'Notification permission is needed to show your reminder at the time you choose. Reminders stay on this phone; nothing is sent to a server.',
      rem_name: 'Reminder name', rem_when: 'Date and time', rem_save: 'Save reminder',
      rem_list: 'Your reminders', rem_none: 'No reminders yet', rem_del: 'Cancel',
      rem_ok: 'Reminder set.', rem_past: 'Choose a future date and time.', rem_noname: 'Give the reminder a name.',
      rem_denied: 'Notification permission is off. Enable it in phone Settings.',
      rem_unavail: 'Reminders are not available on this device.',
      rem_fail: 'Could not set the reminder. Please try again.',
      rem_body: 'KumbhConnect reminder',
      app_card: 'Share the app', app_card_s: 'Send to friends and family',
      app_msg: 'KumbhConnect – Nashik Kumbh Mela Guide',
      near_card: 'Nearby places', near_card_s: 'Sorted by distance from you',
      near_t: 'Nearby places', near_none: 'Could not show nearby places.',
      near_wait: 'Finding your location…'
    }
  };
  function lang() { try { return typeof _lang !== 'undefined' ? _lang : 'mr'; } catch (e) { return 'mr'; } }
  function t(k) { var d = TX[lang() === 'mr' ? 'mr' : 'en']; return d[k] !== undefined ? d[k] : TX.en[k] || ''; }

  // Uses the app's own toast() when present, otherwise a small native-styled one.
  var toastEl = null, toastTimer = null;
  function say(msg) {
    try { if (typeof toast === 'function') { toast(msg); return; } } catch (e) { /* use fallback */ }
    if (!toastEl) {
      toastEl = el('div', 'kcn-toast');
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      toastEl.hidden = true;
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2800);
  }

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
        wrap.remove(); dlgOpen = null; activeClose = null;
        try { if (prev && prev.focus) prev.focus(); } catch (e) { /* no-op */ }
        resolve(v);
      }
      function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); done(false); } }
      ok.addEventListener('click', function () { done(true); });
      no.addEventListener('click', function () { done(false); });
      wrap.addEventListener('click', function (e) { if (e.target === wrap) done(false); });
      document.addEventListener('keydown', onKey, true);
      activeClose = function () { done(false); };
      document.body.appendChild(wrap);
      ok.focus();
    });
    return dlgOpen;
  }

  // Generic sheet (title + custom body + Close). buildBody(close) must return a DOM node.
  function openSheet(titleText, buildBody) {
    if (activeClose) return null;
    var prev = document.activeElement;
    var wrap = el('div', 'kcn-ov');
    var dlg = el('div', 'kcn-dlg');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-label', titleText);
    var h = el('h3'); h.textContent = titleText; dlg.appendChild(h);
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      wrap.remove(); activeClose = null;
      try { if (prev && prev.focus) prev.focus(); } catch (e) { /* no-op */ }
    }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
    dlg.appendChild(buildBody(close));
    var row = el('div', 'kcn-row');
    row.style.marginTop = '12px';
    var cb = el('button'); cb.type = 'button'; cb.textContent = t('close');
    cb.addEventListener('click', close);
    row.appendChild(cb); dlg.appendChild(row);
    wrap.appendChild(dlg);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    document.addEventListener('keydown', onKey, true);
    activeClose = close;
    document.body.appendChild(wrap);
    cb.focus();
    return close;
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
  async function shareApp() {
    var url = typeof CFG.shareUrl === 'string' && /^https:\/\//i.test(CFG.shareUrl) ? CFG.shareUrl : '';
    var r = await shareText(t('app_msg') + (url ? '\n' + url : ''), 'KumbhConnect');
    if (r === 'error' || r === 'unsupported') say(t('share_fail'));
  }

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

  // ---- Offline banner ----------------------------------------------------
  var offBar = null, netWired = false;
  function showOffline(off) {
    if (!offBar) {
      offBar = el('div', 'kcn-offline');
      offBar.setAttribute('role', 'status');
      offBar.setAttribute('aria-live', 'polite');
      offBar.hidden = true;
      document.body.appendChild(offBar);
    }
    offBar.textContent = t('off');
    offBar.hidden = !off;
  }
  function setupNetwork() {
    if (!isNative() || netWired) return;
    netWired = true;
    var N = plugin('Network');
    if (N) {
      try {
        N.getStatus().then(function (s) { showOffline(!(s && s.connected)); }).catch(function () {});
        N.addListener('networkStatusChange', function (s) { showOffline(!(s && s.connected)); });
        return;
      } catch (e) { /* use browser events below */ }
    }
    window.addEventListener('online', function () { showOffline(false); });
    window.addEventListener('offline', function () { showOffline(true); });
    showOffline(!navigator.onLine);
  }

  // ---- Personal reminders (Local Notifications, on-device only) ----------
  function localIso(d) {
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function styleInput(n) {
    n.style.cssText = 'width:100%;box-sizing:border-box;min-height:48px;padding:10px 12px;margin:0 0 10px;' +
      'border:1.5px solid #e0c9a8;border-radius:10px;background:#fff;color:#2b1a0c;font:inherit;font-size:16px';
  }
  async function openReminders() {
    var L = plugin('LocalNotifications');
    if (!L) { say(t('rem_unavail')); return; }
    var s;
    try { s = await L.checkPermissions(); } catch (e) { say(t('rem_unavail')); return; }
    if (s && s.display === 'denied') { say(t('rem_denied')); return; }
    if (!s || s.display !== 'granted') {
      var go = await ask('rem_t', 'rem_b');
      if (!go) return;
      try { s = await L.requestPermissions(); } catch (e) { say(t('rem_unavail')); return; }
      if (!s || s.display !== 'granted') { say(t('rem_denied')); return; }
    }
    openSheet(t('rem_t'), function () {
      var box = el('div');
      var name = el('input'); name.type = 'text'; name.maxLength = 60;
      name.placeholder = t('rem_name'); name.setAttribute('aria-label', t('rem_name')); styleInput(name);
      var when = el('input'); when.type = 'datetime-local';
      when.min = localIso(new Date(Date.now() + 60000));
      when.setAttribute('aria-label', t('rem_when')); styleInput(when);
      var save = el('button', 'kcn-btn'); save.type = 'button'; save.textContent = t('rem_save');
      var head = el('div', 'kcn-h'); head.textContent = t('rem_list'); head.style.margin = '14px 0 8px';
      var list = el('ul', 'kcn-list');

      async function refresh() {
        list.textContent = '';
        var items = [];
        try { var p = await L.getPending(); items = (p && p.notifications) || []; } catch (e) { /* show empty */ }
        if (!items.length) {
          var e0 = el('li', 'kcn-empty'); e0.textContent = t('rem_none'); list.appendChild(e0); return;
        }
        items.forEach(function (n) {
          var li = el('li', 'kcn-item');
          var tx = el('span', 'kcn-tx');
          var b = el('b'); b.textContent = n.title || '';
          var sm = el('small');
          try { sm.textContent = n.schedule && n.schedule.at ? new Date(n.schedule.at).toLocaleString() : ''; } catch (e) { sm.textContent = ''; }
          tx.appendChild(b); tx.appendChild(sm);
          var del = el('button', 'kcn-btn kcn-ghost'); del.type = 'button'; del.textContent = t('rem_del');
          del.style.width = 'auto'; del.style.minWidth = '88px';
          del.addEventListener('click', async function () {
            try { await L.cancel({ notifications: [{ id: n.id }] }); } catch (e) { /* refresh anyway */ }
            refresh();
          });
          li.appendChild(tx); li.appendChild(del); list.appendChild(li);
        });
      }

      save.addEventListener('click', async function () {
        var title = name.value.trim();
        if (!title) { say(t('rem_noname')); name.focus(); return; }
        var at = when.value ? new Date(when.value) : null;
        if (!at || isNaN(at.getTime()) || at.getTime() <= Date.now() + 15000) { say(t('rem_past')); when.focus(); return; }
        try {
          await L.schedule({
            notifications: [{
              id: Math.floor(Date.now() / 1000) % 2000000000,
              title: title, body: t('rem_body'),
              schedule: { at: at, allowWhileIdle: true }
            }]
          });
          name.value = ''; when.value = '';
          say(t('rem_ok')); refresh();
        } catch (e) { say(t('rem_fail')); }
      });

      box.appendChild(name); box.appendChild(when); box.appendChild(save);
      box.appendChild(head); box.appendChild(list);
      refresh();
      return box;
    });
  }

  // ---- Nearby places (config-driven, one GPS fix, nothing sent anywhere) --
  function distM(aLat, aLng, bLat, bLng) {
    var R = 6371000, r = Math.PI / 180;
    var dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function fmtDist(m) { return m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1) + ' km'; }
  // Places come from KC_NATIVE_CONFIG.places if given, otherwise from the app's own LOCS list
  // (ghats, hospitals, police, parking, temples...), so no coordinates are duplicated or invented here.
  function appPlaces() {
    var src = [];
    try { if (typeof LOCS !== 'undefined' && Array.isArray(LOCS)) src = LOCS; } catch (e) { /* none */ }
    var en = lang() === 'en';
    return src.map(function (x) {
      return {
        name: (en ? (x.e || x.n) : (x.n || x.e)) || '',
        lat: x.la, lng: x.lo, note: x.a || '', type: x.t || '', icon: x.ic || ''
      };
    });
  }
  function validPlaces() {
    var src = Array.isArray(CFG.places) && CFG.places.length ? CFG.places : appPlaces();
    return src.filter(function (p) {
      return p && typeof p.name === 'string' && p.name &&
        typeof p.lat === 'number' && isFinite(p.lat) && Math.abs(p.lat) <= 90 &&
        typeof p.lng === 'number' && isFinite(p.lng) && Math.abs(p.lng) <= 180;
    });
  }
  var NEAR_FILTERS = [
    { k: '',         mr: 'सर्व',      en: 'All' },
    { k: 'ghat',     mr: 'घाट',       en: 'Ghats' },
    { k: 'hospital', mr: 'रुग्णालय',  en: 'Hospitals' },
    { k: 'police',   mr: 'पोलीस',     en: 'Police' },
    { k: 'parking',  mr: 'पार्किंग',  en: 'Parking' },
    { k: 'temple',   mr: 'मंदिर',     en: 'Temples' }
  ];
  function showNearby() {
    var places = validPlaces();
    if (!places.length || !navigator.geolocation) { say(t('near_none')); return; }
    var holder = null;
    var close = openSheet(t('near_t'), function () {
      holder = el('div');
      var w = el('div', 'kcn-empty'); w.textContent = t('near_wait'); holder.appendChild(w);
      return holder;
    });
    if (!close) return;
    navigator.geolocation.getCurrentPosition(function (pos) {
      if (!holder || !holder.isConnected) return;               // sheet already closed
      var me = pos && pos.coords;
      if (!me) { holder.textContent = t('near_none'); return; }
      var all = places.map(function (p) {
        return { p: p, d: distM(me.latitude, me.longitude, p.lat, p.lng) };
      }).sort(function (a, b) { return a.d - b.d; });

      var present = {};
      all.forEach(function (r) { if (r.p.type) present[r.p.type] = true; });
      var filters = NEAR_FILTERS.filter(function (f) { return f.k === '' || present[f.k]; });
      var active = '';
      var chips = el('div', 'kcn-chips');
      var ul = el('ul', 'kcn-list');

      function draw() {
        ul.textContent = '';
        var rows = all.filter(function (r) { return !active || r.p.type === active; }).slice(0, 8);
        if (!rows.length) { var e0 = el('li', 'kcn-empty'); e0.textContent = t('near_none'); ul.appendChild(e0); return; }
        rows.forEach(function (r) {
          var li = el('li', 'kcn-item');
          if (r.p.icon) { var ic = el('span', 'kcn-i'); ic.setAttribute('aria-hidden', 'true'); ic.textContent = r.p.icon; li.appendChild(ic); }
          var tx = el('span', 'kcn-tx');
          var b = el('b'); b.textContent = r.p.name; tx.appendChild(b);
          if (typeof r.p.note === 'string' && r.p.note) { var sm = el('small'); sm.textContent = r.p.note; tx.appendChild(sm); }
          var dist = el('span', 'kcn-dist'); dist.textContent = fmtDist(r.d);
          li.appendChild(tx); li.appendChild(dist); ul.appendChild(li);
        });
      }
      if (filters.length > 1) {
        filters.forEach(function (f) {
          var c = el('button', 'kcn-chip'); c.type = 'button';
          c.textContent = lang() === 'en' ? f.en : f.mr;
          c.setAttribute('aria-pressed', f.k === active ? 'true' : 'false');
          c.addEventListener('click', function () {
            active = f.k;
            Array.prototype.forEach.call(chips.children, function (x, i) {
              x.setAttribute('aria-pressed', filters[i].k === active ? 'true' : 'false');
            });
            draw();
          });
          chips.appendChild(c);
        });
      }
      holder.textContent = '';
      if (filters.length > 1) holder.appendChild(chips);
      holder.appendChild(ul);
      draw();
    }, function () {
      if (!holder || !holder.isConnected) return;
      holder.textContent = '';
      var m = el('div', 'kcn-empty'); m.textContent = t('loc_denied'); holder.appendChild(m);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  // ---- Home tools card ---------------------------------------------------
  function openMyLocation() {
    if (typeof nav === 'function') nav('map');
    setTimeout(function () { if (typeof myLocation === 'function') myLocation(); }, 400);
  }
  function openComplaintPhoto() {
    if (typeof nav === 'function') nav('sos');
    setTimeout(function () {
      var elx = document.getElementById('kcn-photo') || document.getElementById('griev');
      if (elx && elx.scrollIntoView) elx.scrollIntoView({ block: 'center' });
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
    if (isNative() && validPlaces().length && navigator.geolocation) {
      items.push({ id: 'near', cls: '', ico: '\uD83E\uDDED', a: t('near_card'), b: t('near_card_s'), fn: showNearby });
    }
    if (isNative() && plugin('LocalNotifications')) {
      items.push({ id: 'rem', cls: '', ico: '\u23F0', a: t('rem_card'), b: t('rem_card_s'), fn: openReminders });
    }
    if (pushAvailable()) items.push({ id: 'push', cls: '', ico: '\uD83D\uDD14', a: t('push_btn'), b: t('push_t'), fn: enablePush });
    if (canShare()) items.push({ id: 'app', cls: '', ico: '\uD83D\uDCE4', a: t('app_card'), b: t('app_card_s'), fn: shareApp });
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

  // ---- Native Android polish ---------------------------------------------
  // All of these are optional Capacitor plugins. If a plugin is not installed,
  // the existing web/PWA experience continues without throwing an error.
  function setupStatusBar() {
    if (!isNative()) return;
    var S = plugin('StatusBar');
    if (!S) return;
    try {
      if (typeof S.setBackgroundColor === 'function') S.setBackgroundColor({ color: '#C8410A' });
      // FIX: the plugin's Style enum is not exposed without a bundler, so use the string value.
      // 'DARK' = light (white) icons for a dark/saffron background.
      if (typeof S.setStyle === 'function') S.setStyle({ style: 'DARK' });
      if (typeof S.show === 'function') S.show();
    } catch (e) { /* optional native styling */ }
  }

  function hideNativeSplash() {
    if (!isNative()) return;
    var S = plugin('SplashScreen');
    if (!S || typeof S.hide !== 'function') return;
    // Small delay avoids a flash before the first app frame is painted.
    setTimeout(function () { try { S.hide(); } catch (e) { /* optional */ } }, 120);
  }

  function visiblePage() {
    for (var i = 0; i < NAV_PAGES.length; i++) {
      var pg = document.getElementById('pg-' + NAV_PAGES[i]);
      if (!pg) continue;
      var cs;
      try { cs = window.getComputedStyle(pg); } catch (e) { cs = null; }
      if (cs && cs.display !== 'none' && cs.visibility !== 'hidden' && pg.getClientRects().length) {
        return NAV_PAGES[i];
      }
    }
    return 'home';
  }

  function handleAndroidBack() {
    // 1) Close the top dialog/sheet first.
    if (activeClose) { try { activeClose(); } catch (e) { /* no-op */ } return; }
    // 2) Any other page goes back to Home.
    var page = visiblePage();
    if (page !== 'home' && typeof window.nav === 'function') {
      try { window.nav('home'); lastBackAt = 0; return; } catch (e) { /* continue */ }
    }
    // 3) On Home: press twice to exit.
    var now = Date.now();
    if (now - lastBackAt < BACK_EXIT_WINDOW_MS) {
      var A = plugin('App');
      try { if (A && typeof A.exitApp === 'function') { A.exitApp(); return; } } catch (e) { /* fallback below */ }
    }
    lastBackAt = now;
    say(t('back_exit'));
  }

  function setupNativeAppEvents() {
    if (!isNative() || nativeWired) return;
    nativeWired = true;
    var A = plugin('App');
    if (A && typeof A.addListener === 'function') {
      try {
        A.addListener('backButton', function () { handleAndroidBack(); });
      } catch (e) { /* native back handling is optional */ }
      try {
        A.addListener('appStateChange', function (state) {
          if (state && state.isActive) {
            // Refresh language-dependent controls after returning from Settings/share sheet.
            try { renderHome(); refreshPhotoUi(); } catch (e) { /* no-op */ }
          }
        });
      } catch (e) { /* optional lifecycle listener */ }
    }

    // Keep the viewport usable when the Android soft keyboard opens.
    var K = plugin('Keyboard');
    if (K) {
      // FIX: Keyboard.Resize enum is not available without a bundler; 'native' is the string value.
      try { if (typeof K.setResizeMode === 'function') K.setResizeMode({ mode: 'native' }); } catch (e) { /* optional */ }
      try {
        if (typeof K.addListener === 'function') {
          K.addListener('keyboardDidShow', function () { document.documentElement.classList.add('kc-keyboard-open'); });
          K.addListener('keyboardDidHide', function () { document.documentElement.classList.remove('kc-keyboard-open'); });
        }
      } catch (e) { /* optional */ }
    }
  }

  function wireHaptics() {
    if (!isNative()) return;
    // Use delegation because the SOS panel may be created/re-rendered dynamically.
    document.addEventListener('click', function (e) {
      var target = e.target && e.target.closest ? e.target.closest('[data-kcn-haptic], #sos-btn, #sos-open, .sos-fab, [data-action="sos"]') : null;
      if (!target) return;
      haptic(target.matches('[data-kcn-haptic="warn"], #sos-btn, #sos-open, .sos-fab, [data-action="sos"]') ? 'warn' : 'light');
    }, true);
  }

  // ---- Boot --------------------------------------------------------------
  function patchSetLang() {
    if (typeof window.setLang !== 'function' || window.setLang.__kcn) return;
    var orig = window.setLang;
    var w = function () {
      var r = orig.apply(this, arguments);
      try { renderHome(); refreshPhotoUi(); if (offBar && !offBar.hidden) offBar.textContent = t('off'); } catch (e) { /* no-op */ }
      return r;
    };
    w.__kcn = true; window.setLang = w;
  }
  function init() {
    if (isNative()) document.documentElement.classList.add('kc-native');
    installGeolocation();
    mountPhotoControls();
    renderHome();
    patchSetLang();
    setupStatusBar();
    setupNativeAppEvents();
    setupNetwork();
    wireHaptics();
    hideNativeSplash();
  }

  window.KCNative = {
    isNative: isNative, t: t, haptic: haptic, canShare: canShare, shareSos: shareSos,
    shareText: shareText, shareApp: shareApp, mayAutoLocate: mayAutoLocate,
    pickPhoto: pickPhoto, removePhoto: removePhoto,
    enablePush: enablePush, refreshPhotoUi: refreshPhotoUi,
    openReminders: openReminders, showNearby: showNearby,
    setupStatusBar: setupStatusBar, setupNativeAppEvents: setupNativeAppEvents,
    handleAndroidBack: handleAndroidBack
  };

  // Capacitor injects window.Capacitor before page scripts on Android; init after DOM is ready.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
