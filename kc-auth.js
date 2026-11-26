/* ================================================================
 * KumbhConnect — kc-auth.js  (v1.7.1)
 * Login / Registration:
 *   - Email + password (register needs name + email + password; account must verify the email link)
 *   - Google login (native Android via @capacitor-firebase/authentication, browser via popup/redirect)
 *   - Fake / disposable email blocking (Guard below) + real ownership proof via the verification mail
 *   - Bot protection: Firebase App Check (see firebase-config.js) + a hidden honeypot field here
 * NO mobile OTP any more.
 *
 * Loaded AFTER the main inline script in index.html (needs: auth, db, COL_USERS, toast, kcIsNativeApp).
 * Pure helpers (Guard) are exported for node tests.
 *
 * SECURITY NOTE: everything here runs in the browser and can be bypassed by a modified client.
 * Real enforcement = Firestore rules (request.auth.token.email_verified) + App Check ENFORCEMENT
 * (Firebase console). See AUTH-SETUP.md.
 * ================================================================ */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------
   * 1. GUARD — email validation (pure, no DOM, no Firebase)
   * ------------------------------------------------------------- */
  var DISPOSABLE = (
    'mailinator.com,guerrillamail.com,guerrillamail.net,guerrillamail.org,guerrillamail.biz,guerrillamail.de,sharklasers.com,grr.la,' +
    '10minutemail.com,10minutemail.net,10minutemail.co.uk,20minutemail.com,tempmail.com,temp-mail.org,temp-mail.io,tempmail.net,tempmail.dev,' +
    'tempmailo.com,tempail.com,tempr.email,throwawaymail.com,trashmail.com,trashmail.net,trashmail.de,trash-mail.com,yopmail.com,yopmail.net,yopmail.fr,' +
    'getnada.com,nada.email,dispostable.com,maildrop.cc,mailnesia.com,mintemail.com,mohmal.com,emailondeck.com,fakeinbox.com,fakemail.net,' +
    'fakemailgenerator.com,spamgourmet.com,spambox.us,spam4.me,mytemp.email,moakt.com,tmpmail.org,tmpmail.net,burnermail.io,anonbox.net,' +
    'discard.email,discardmail.com,discardmail.de,mailcatch.com,mailforspam.com,mailnull.com,mailsac.com,inboxbear.com,inboxkitten.com,' +
    'getairmail.com,gettempmail.com,harakirimail.com,incognitomail.com,instantemailaddress.com,jetable.org,kasmail.com,mail-temporary.com,' +
    'mailtemp.info,mailtothis.com,meltmail.com,mt2015.com,mytrashmail.com,no-spam.ws,nospam.ze.tc,objectmail.com,owlymail.com,proxymail.eu,' +
    'rcpt.at,safetymail.info,schrott-email.de,selfdestructingmail.com,sendspamhere.com,sogetthis.com,spamavert.com,spamfree24.org,spamhole.com,' +
    'spamify.com,spaml.com,tafmail.com,teleworm.us,tempinbox.com,tempomail.fr,temporaryemail.net,temporaryinbox.com,thankyou2010.com,' +
    'trbvm.com,trashmail.ws,wegwerfmail.de,wegwerfmail.net,wh4f.org,yepmail.com,zehnminutenmail.de,zippymail.info,emailfake.com,email-fake.com,' +
    'crazymailing.com,cuvox.de,dayrep.com,einrot.com,fleckens.hu,gustr.com,jourrapide.com,rhyta.com,superrito.com,armyspy.com,' +
    'dropmail.me,emltmp.com,1secmail.com,1secmail.net,1secmail.org,esiix.com,wwjmp.com,xojxe.com,vjuum.com,laafd.com,txcct.com,' +
    'mailpoof.com,minuteinbox.com,mail.tm,bugmenot.com,byom.de,deadaddress.com,despam.it,devnullmail.com,disposableaddress.com,' +
    'example.com,example.org,example.net,test.com,test.test,invalid.com,domain.com,email.com.invalid,mailinator.net,mailinator2.com,' +
    'cool.fr.nf,courriel.fr.nf,jetable.fr.nf,moncourrier.fr.nf,monemail.fr.nf,monmail.fr.nf,nospamfor.us,tempsky.com,tempmailer.com,' +
    'luxusmail.org,lroid.com,throwam.com,mailbox92.biz,33mail.com,anonaddy.me,simplelogin.com,duck.com.invalid'
  ).split(',').reduce(function (m, d) { m[d] = 1; return m; }, {});

  // Very common typos of big providers → suggest the right one instead of silently accepting a dead address.
  var TYPOS = {
    'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com',
    'gmail.om': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmeil.com': 'gmail.com',
    'gmail.in': 'gmail.com', 'gmail.comm': 'gmail.com', 'gmali.com': 'gmail.com', 'gimail.com': 'gmail.com',
    'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yhoo.com': 'yahoo.com',
    'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'outlok.com': 'outlook.com',
    'outlook.con': 'outlook.com', 'rediffmal.com': 'rediffmail.com', 'icloud.con': 'icloud.com'
  };

  // Local parts nobody really uses.
  var FAKE_LOCALS = /^(test|testing|tester|test\d*|fake|fakemail|demo|dummy|abc|abcd|abcde|abcdef|asdf|asdfg|asdfgh|qwerty|qwerty\d*|xyz|xxx|aaa|none|noemail|no-?reply|nomail|na|nil|null|user|user\d*|email|mail|example|sample|temp|temporary|random|abc123|123456|12345678)$/i;

  function parseEmail(raw) {
    var e = String(raw == null ? '' : raw).trim().toLowerCase();
    var at = e.lastIndexOf('@');
    if (at < 1 || at !== e.indexOf('@')) return null;
    return { full: e, local: e.slice(0, at), domain: e.slice(at + 1) };
  }

  /** Returns { ok:true, email } or { ok:false, code, suggestion? }.
   *  codes: syntax | disposable | typo | fake */
  function checkEmail(raw) {
    var p = parseEmail(raw);
    if (!p || p.full.length > 254) return { ok: false, code: 'syntax' };
    var local = p.local, domain = p.domain;
    if (local.length > 64 || !/^[a-z0-9]([a-z0-9._%+\-]*[a-z0-9])?$/.test(local) || /\.\./.test(local)) return { ok: false, code: 'syntax' };
    if (!/^[a-z0-9]([a-z0-9\-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]*[a-z0-9])?)+$/.test(domain)) return { ok: false, code: 'syntax' };
    var tld = domain.slice(domain.lastIndexOf('.') + 1);
    if (!/^[a-z]{2,24}$/.test(tld)) return { ok: false, code: 'syntax' };

    if (TYPOS[domain]) return { ok: false, code: 'typo', suggestion: local + '@' + TYPOS[domain] };

    // match the domain and every parent domain (a.b.mailinator.com → mailinator.com)
    var parts = domain.split('.');
    for (var i = 0; i < parts.length - 1; i++) {
      if (DISPOSABLE[parts.slice(i).join('.')]) return { ok: false, code: 'disposable' };
    }

    var base = local.split('+')[0];
    var bare = base.replace(/[._\-]/g, '');
    if (FAKE_LOCALS.test(base) || FAKE_LOCALS.test(bare)) return { ok: false, code: 'fake' };
    if (bare.length >= 4 && /^(.)\1+$/.test(bare)) return { ok: false, code: 'fake' };          // aaaaaa@…
    if (/^\d+$/.test(bare) && bare.length < 8) return { ok: false, code: 'fake' };               // 12345@…
    if (domain === 'gmail.com' || domain === 'googlemail.com') {
      // Gmail rules: 6–30 chars, letters/digits/dots only, no "+" is fine but base must satisfy rule.
      if (bare.length < 6 || bare.length > 30 || !/^[a-z0-9.]+$/.test(base)) return { ok: false, code: 'fake' };
    }
    return { ok: true, email: p.full };
  }

  var Guard = { checkEmail: checkEmail, isDisposableDomain: function (d) { return !!DISPOSABLE[String(d).toLowerCase()]; } };
  if (typeof module !== 'undefined' && module.exports) { module.exports = { Guard: Guard }; }
  if (typeof document === 'undefined') { return; }   // node (tests) stops here

  /* ---------------------------------------------------------------
   * 2. TEXT (mr / hi / en)
   * ------------------------------------------------------------- */
  var T = {
    mr: {
      title: 'कुंभ कनेक्ट मध्ये स्वागत आहे', sub: 'तुमच्या Email किंवा Google खात्याने सुरक्षित Login करा',
      tab_login: 'लॉगिन', tab_register: 'रजिस्ट्रेशन', or: 'किंवा', btn_google: 'Google ने पुढे जा',
      lbl_name: 'पूर्ण नाव', lbl_email: 'Email', lbl_pass: 'Password (किमान ८ अक्षरे)', lbl_pass_login: 'Password',
      ph_name: 'तुमचं नाव', btn_login: 'लॉगिन करा', forgot: 'पासवर्ड विसरलात?', btn_register: 'रजिस्टर करा',
      verify_title: 'Email Verify करा', verify_sent: 'आम्ही {e} वर verification link पाठवली आहे. ती उघडा आणि परत येऊन खालील बटण दाबा. (Spam/Promotions फोल्डरही पहा)',
      btn_verified: 'मी Verify केले', resend: 'Link पुन्हा पाठवा', resend_in: 'पुन्हा पाठवा ({s}s)',
      profile_title: 'प्रोफाइल पूर्ण करा', profile_sub: 'नाव आणि Email टाका', btn_save: 'सेव्ह करा आणि पुढे जा',
      other_account: 'दुसऱ्या खात्याने Login करा', terms: 'पुढे गेल्यावर तुम्ही आमच्या <a href="terms.html">अटी</a> आणि <a href="privacy-policy.html">गोपनीयता धोरण</a> मान्य करता.',
      wait: 'कृपया थांबा…', ok_login: 'Login यशस्वी ✅', ok_register: 'रजिस्ट्रेशन पूर्ण झाले ✅', ok_verified: 'Email verify झाला ✅',
      e_name: 'कृपया तुमचं पूर्ण नाव टाका', e_email: 'योग्य Email टाका', e_pass8: 'Password किमान ८ अक्षरांचा हवा', e_pass: 'Password टाका',
      e_disposable: 'Temporary / Fake Email चालत नाही. तुमचा खरा Email वापरा.', e_fake: 'हा Email खरा वाटत नाही. तुमचा खरा Email टाका.',
      e_typo: 'Email चुकीचा वाटतो. तुम्हाला "{s}" म्हणायचं आहे का?', e_network: 'इंटरनेट/नेटवर्क समस्या — पुन्हा प्रयत्न करा',
      e_wrong_cred: 'Email किंवा Password चुकीचा आहे', e_email_used: 'हा Email आधीच वापरात आहे — Login करा किंवा पासवर्ड रीसेट करा',
      e_too_many: 'खूप प्रयत्न झाले — थोड्या वेळाने पुन्हा करा', e_not_verified: 'Email अजून verify झालेला नाही — मेलमधील link उघडा',
      e_google: 'Google Login होऊ शकला नाही — पुन्हा प्रयत्न करा', e_google_cancel: 'Google Login रद्द केले',
      e_generic: 'काहीतरी चुकलं — पुन्हा प्रयत्न करा', e_pwa_google: 'Google Login इन्स्टॉल केलेल्या PWA मध्ये चालत नाही — Email ने Login करा',
      e_not_enabled: 'Firebase मध्ये हा Login प्रकार चालू नाही (Console → Authentication → Sign-in method)', e_domain: 'ही साईट Firebase Authorized domains मध्ये नाही',
      e_blocked_key: 'Firebase API key ने विनंती ब्लॉक केली (Google Cloud → API key restrictions तपासा)', e_app_check: 'सुरक्षा तपासणी (App Check) अयशस्वी — ॲप अपडेट करा',
      e_disabled: 'हे खाते बंद केले आहे', e_account_other: 'या Email चे खाते दुसऱ्या Login पद्धतीने आहे — तीच पद्धत वापरा',
      reset_sent: 'हा Email नोंदणीकृत असल्यास Password reset link पाठवला आहे', reset_need: 'आधी तुमचा Email टाका', email_verify_sent: 'Verification link पाठवली आहे'
    },
    hi: {
      title: 'कुंभ कनेक्ट में स्वागत है', sub: 'अपने Email या Google खाते से सुरक्षित Login करें',
      tab_login: 'लॉगिन', tab_register: 'रजिस्ट्रेशन', or: 'या', btn_google: 'Google से आगे बढ़ें',
      lbl_name: 'पूरा नाम', lbl_email: 'Email', lbl_pass: 'Password (कम से कम 8 अक्षर)', lbl_pass_login: 'Password',
      ph_name: 'आपका नाम', btn_login: 'लॉगिन करें', forgot: 'पासवर्ड भूल गए?', btn_register: 'रजिस्टर करें',
      verify_title: 'Email Verify करें', verify_sent: 'हमने {e} पर verification link भेजी है। उसे खोलें और लौटकर नीचे का बटन दबाएँ। (Spam/Promotions फ़ोल्डर भी देखें)',
      btn_verified: 'मैंने Verify कर लिया', resend: 'Link दोबारा भेजें', resend_in: 'दोबारा भेजें ({s}s)',
      profile_title: 'प्रोफ़ाइल पूरी करें', profile_sub: 'नाम और Email डालें', btn_save: 'सेव करें और आगे बढ़ें',
      other_account: 'दूसरे खाते से Login करें', terms: 'आगे बढ़ने पर आप हमारी <a href="terms.html">शर्तें</a> और <a href="privacy-policy.html">गोपनीयता नीति</a> मानते हैं।',
      wait: 'कृपया प्रतीक्षा करें…', ok_login: 'Login सफल ✅', ok_register: 'रजिस्ट्रेशन पूरा हुआ ✅', ok_verified: 'Email verify हो गया ✅',
      e_name: 'कृपया अपना पूरा नाम डालें', e_email: 'सही Email डालें', e_pass8: 'Password कम से कम 8 अक्षर का हो', e_pass: 'Password डालें',
      e_disposable: 'Temporary / Fake Email मान्य नहीं है। अपना असली Email इस्तेमाल करें।', e_fake: 'यह Email असली नहीं लगता। अपना असली Email डालें।',
      e_typo: 'Email गलत लगता है। क्या आपका मतलब "{s}" है?', e_network: 'इंटरनेट/नेटवर्क समस्या — दोबारा कोशिश करें',
      e_wrong_cred: 'Email या Password गलत है', e_email_used: 'यह Email पहले से इस्तेमाल में है — Login करें या पासवर्ड रीसेट करें',
      e_too_many: 'बहुत प्रयास हो गए — थोड़ी देर बाद करें', e_not_verified: 'Email अभी verify नहीं हुआ — मेल में दिया link खोलें',
      e_google: 'Google Login नहीं हो सका — दोबारा कोशिश करें', e_google_cancel: 'Google Login रद्द किया गया',
      e_generic: 'कुछ गड़बड़ हुई — दोबारा कोशिश करें', e_pwa_google: 'Google Login इंस्टॉल किए गए PWA में नहीं चलता — Email से Login करें',
      e_not_enabled: 'Firebase में यह Login तरीका चालू नहीं है (Console → Authentication → Sign-in method)', e_domain: 'यह साइट Firebase Authorized domains में नहीं है',
      e_blocked_key: 'Firebase API key ने अनुरोध रोका (Google Cloud → API key restrictions जाँचें)', e_app_check: 'सुरक्षा जाँच (App Check) विफल — ऐप अपडेट करें',
      e_disabled: 'यह खाता बंद कर दिया गया है', e_account_other: 'इस Email का खाता दूसरे Login तरीके से बना है — वही तरीका इस्तेमाल करें',
      reset_sent: 'यह Email पंजीकृत हो तो Password reset link भेजा गया है', reset_need: 'पहले अपना Email डालें', email_verify_sent: 'Verification link भेज दी गई है'
    },
    en: {
      title: 'Welcome to KumbhConnect', sub: 'Log in securely with your email or Google account',
      tab_login: 'Login', tab_register: 'Register', or: 'or', btn_google: 'Continue with Google',
      lbl_name: 'Full name', lbl_email: 'Email', lbl_pass: 'Password (min. 8 characters)', lbl_pass_login: 'Password',
      ph_name: 'Your name', btn_login: 'Login', forgot: 'Forgot password?', btn_register: 'Register',
      verify_title: 'Verify your email', verify_sent: 'We sent a verification link to {e}. Open it, then come back and tap the button below. (Check Spam/Promotions too)',
      btn_verified: 'I have verified', resend: 'Resend link', resend_in: 'Resend in {s}s',
      profile_title: 'Complete your profile', profile_sub: 'Enter your name and email', btn_save: 'Save & continue',
      other_account: 'Login with another account', terms: 'By continuing you accept our <a href="terms.html">Terms</a> and <a href="privacy-policy.html">Privacy Policy</a>.',
      wait: 'Please wait…', ok_login: 'Logged in ✅', ok_register: 'Registration complete ✅', ok_verified: 'Email verified ✅',
      e_name: 'Please enter your full name', e_email: 'Enter a valid email', e_pass8: 'Password must be at least 8 characters', e_pass: 'Enter your password',
      e_disposable: 'Temporary / fake email addresses are not allowed. Use your real email.', e_fake: 'This email does not look real. Enter your real email.',
      e_typo: 'This email looks mistyped. Did you mean "{s}"?', e_network: 'Network problem — please try again',
      e_wrong_cred: 'Wrong email or password', e_email_used: 'This email is already in use — log in or reset your password',
      e_too_many: 'Too many attempts — try again later', e_not_verified: 'Email is not verified yet — open the link in your mail',
      e_google: 'Google login failed — please try again', e_google_cancel: 'Google login cancelled',
      e_generic: 'Something went wrong — please try again', e_pwa_google: 'Google login does not work in an installed PWA — use email login',
      e_not_enabled: 'This sign-in method is not enabled in Firebase (Console → Authentication → Sign-in method)', e_domain: 'This site is not in Firebase Authorized domains',
      e_blocked_key: 'Firebase API key blocked the request (check Google Cloud → API key restrictions)', e_app_check: 'Security check (App Check) failed — please update the app',
      e_disabled: 'This account has been disabled', e_account_other: 'An account with this email uses another sign-in method — use that method',
      reset_sent: 'If this email is registered, a password reset link has been sent', reset_need: 'Enter your email first', email_verify_sent: 'Verification link sent'
    }
  };
  function lang() { var l = (typeof _lang !== 'undefined' && _lang) || localStorage.getItem('kc_lang') || 'mr'; return T[l] ? l : 'mr'; }
  function tx(k, vars) {
    var s = (T[lang()][k] !== undefined ? T[lang()][k] : T.en[k]) || k;
    if (vars) Object.keys(vars).forEach(function (n) { s = s.replace('{' + n + '}', vars[n]); });
    return s;
  }

  /* ---------------------------------------------------------------
   * 3. helpers
   * ------------------------------------------------------------- */
  var $ = function (id) { return document.getElementById(id); };
  var gate = function () { return $('login-gate'); };
  var ctx = { step: 'login', busyRegister: false, user: null };
  var lastMailAt = 0, tickTimer = null, pollTimer = null, openedAt = 0;

  function withTimeout(p, ms, label) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej({ code: 'kca/timeout', message: label + ' timeout' }); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }

  // Same lookup as kc-native.js: Capacitor.Plugins is NOT filled for plugins we never import in JS.
  var _plugin;
  function nativePlugin() {
    if (_plugin !== undefined) return _plugin;
    _plugin = null;
    try {
      var C = root.Capacitor;
      if (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() &&
          (typeof C.isPluginAvailable !== 'function' || C.isPluginAvailable('FirebaseAuthentication'))) {
        _plugin = (typeof C.registerPlugin === 'function' ? C.registerPlugin('FirebaseAuthentication') : null) ||
                  (C.Plugins && C.Plugins.FirebaseAuthentication) || null;
      }
    } catch (e) { _plugin = null; }
    return _plugin;
  }
  function isNative() { return typeof kcIsNativeApp === 'function' && kcIsNativeApp(); }

  function setMsg(text, ok) {
    var el = $('kca-msg'); if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('show', !!text);
    el.classList.toggle('ok', !!ok);
    if (text && el.scrollIntoView) { try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* no-op */ } }
  }
  function say(text) { if (typeof toast === 'function') toast(text); }
  function setBusy(btnId, busy, label) {
    var b = $(btnId); if (!b) return;
    if (busy) { b.dataset.label = b.textContent; b.textContent = label || tx('wait'); b.disabled = true; }
    else { if (b.dataset.label) b.textContent = b.dataset.label; b.disabled = false; }
  }

  function errText(err) {
    var c = (err && err.code) || '';
    var m = {
      'auth/invalid-credential': 'e_wrong_cred', 'auth/wrong-password': 'e_wrong_cred', 'auth/user-not-found': 'e_wrong_cred', 'auth/invalid-login-credentials': 'e_wrong_cred',
      'auth/invalid-email': 'e_email', 'auth/email-already-in-use': 'e_email_used', 'auth/weak-password': 'e_pass8',
      'auth/too-many-requests': 'e_too_many', 'auth/user-disabled': 'e_disabled',
      'auth/account-exists-with-different-credential': 'e_account_other',
      'auth/network-request-failed': 'e_network', 'auth/operation-not-allowed': 'e_not_enabled', 'auth/unauthorized-domain': 'e_domain',
      'auth/app-not-authorized': 'e_app_check', 'auth/firebase-app-check-token-is-invalid': 'e_app_check', 'auth/missing-app-credential': 'e_app_check',
      'auth/popup-closed-by-user': 'e_google_cancel', 'auth/cancelled-popup-request': null, 'auth/popup-blocked': 'e_google',
      'kca/timeout': 'e_network', 'kca/no-id-token': 'e_google'
    };
    if (c in m) return m[c] ? tx(m[c]) : '';
    if (/referer|api[-_ ]key/i.test(c + ' ' + (err && err.message || ''))) return tx('e_blocked_key');
    if (err && /cancel/i.test(String(err.message || err.code || ''))) return tx('e_google_cancel');
    try { console.error('[KCAuth]', err); } catch (e) { /* no-op */ }
    // Always show the technical reason so a failing device can be diagnosed from a screenshot.
    var msg = String((err && err.message) || '').replace(/\s+/g, ' ').slice(0, 140);
    return tx('e_generic') + ' [' + (c || 'no-code') + (msg ? ': ' + msg : '') + ']';
  }
  function showErr(err) { var t = typeof err === 'string' ? err : errText(err); if (t) { setMsg('❌ ' + t); say('❌ ' + t); } }

  function emailError(raw) {
    var r = checkEmail(raw);
    if (r.ok) return '';
    if (r.code === 'typo') return tx('e_typo', { s: r.suggestion });
    if (r.code === 'disposable') return tx('e_disposable');
    if (r.code === 'fake') return tx('e_fake');
    return tx('e_email');
  }
  function setAuthLang() { try { auth.languageCode = ({ mr: 'mr', hi: 'hi', en: 'en' })[lang()] || 'en'; } catch (e) { /* no-op */ } }

  /** verified = Google account, or email link confirmed (legacy phone-linked accounts also stay verified) */
  function isVerified(u) {
    return !!(u && (u.emailVerified || u.phoneNumber || (u.providerData || []).some(function (p) { return p && p.providerId === 'google.com'; })));
  }

  /* ---------------------------------------------------------------
   * 4. step / tab handling
   * ------------------------------------------------------------- */
  function applyLang() {
    var g = gate(); if (!g) return;
    g.querySelectorAll('[data-kca]').forEach(function (n) {
      var k = n.getAttribute('data-kca');
      if (k === 'terms') n.innerHTML = tx('terms'); else n.textContent = tx(k);
    });
    g.querySelectorAll('[data-kca-ph]').forEach(function (n) { n.setAttribute('placeholder', tx(n.getAttribute('data-kca-ph'))); });
    g.querySelectorAll('[data-kca-lang]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-kca-lang') === lang()); });
    renderVerifyText(); tickResend();
  }

  function showStep(step) {
    ctx.step = step;
    var g = gate(); if (!g) return;
    g.querySelectorAll('.kca-step').forEach(function (s) { s.classList.toggle('on', s.getAttribute('data-step') === step); });
    var tabs = $('kca-tabs');
    if (tabs) {
      tabs.hidden = !(step === 'login' || step === 'register');
      tabs.querySelectorAll('.kca-tab').forEach(function (t) {
        var on = t.getAttribute('data-kca-tab') === step; t.classList.toggle('on', on); t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    if (step === 'register') openedAt = Date.now();
    setMsg('');
    g.scrollTop = 0;
    managePolling();
  }
  function openGate(step) { var g = gate(); if (!g) return; g.classList.remove('hide'); applyLang(); showStep(step || 'login'); }

  function renderVerifyText() {
    var el = $('kca-verify-text'); if (!el) return;
    var u = ctx.user || auth.currentUser;
    el.textContent = tx('verify_sent', { e: (u && u.email) || '' });
  }
  function tickResend() {
    var b = $('kca-v-resend'); if (!b) return;
    clearTimeout(tickTimer);
    var left = Math.max(0, 60 - Math.floor((Date.now() - lastMailAt) / 1000));
    if (left > 0) { b.disabled = true; b.textContent = tx('resend_in', { s: left }); tickTimer = setTimeout(tickResend, 1000); }
    else { b.disabled = false; b.textContent = tx('resend'); }
  }

  /* ---------------------------------------------------------------
   * 5. email verification
   * ------------------------------------------------------------- */
  async function rerunHandler() {
    if (typeof kcHandleAuthUser === 'function') { try { await kcHandleAuthUser(auth.currentUser); } catch (e) { console.error(e); } }
  }

  async function sendVerificationMail(u) {
    setAuthLang();
    await u.sendEmailVerification();
    lastMailAt = Date.now(); tickResend();
  }

  /** reload the user + force a fresh ID token (Firestore rules read the email_verified claim from it) */
  async function checkVerified(silent) {
    var u = auth.currentUser; if (!u) return false;
    try { await withTimeout(u.reload(), 15000, 'reload'); } catch (e) { if (!silent) showErr(e); return false; }
    if (!isVerified(auth.currentUser)) { if (!silent) showErr(tx('e_not_verified')); return false; }
    try { await auth.currentUser.getIdToken(true); } catch (e) { /* token refreshes on its own later */ }
    say(tx('ok_verified'));
    await rerunHandler();
    return true;
  }
  function managePolling() {
    clearInterval(pollTimer); pollTimer = null;
    var g = gate();
    if (ctx.step === 'verifyemail' && g && !g.classList.contains('hide')) {
      pollTimer = setInterval(function () { if (!document.hidden) checkVerified(true); }, 6000);
    }
  }

  /* ---------------------------------------------------------------
   * 6. forms
   * ------------------------------------------------------------- */
  async function onRegisterSubmit(e) {
    e.preventDefault(); setMsg('');
    // cheap bot traps: hidden honeypot must stay empty, a human needs more than 2 s to fill the form
    if (($('kca-hp') && $('kca-hp').value) || (openedAt && Date.now() - openedAt < 2000)) { showErr(tx('e_generic')); return; }
    var name = $('kca-r-name').value.trim().replace(/\s+/g, ' ');
    var email = $('kca-r-email').value.trim();
    var pass = $('kca-r-pass').value;
    if (name.length < 2 || name.length > 100) return showErr(tx('e_name'));
    var ee = emailError(email); if (ee) return showErr(ee);
    if (pass.length < 8) return showErr(tx('e_pass8'));
    email = email.toLowerCase();

    setBusy('kca-r-btn', true);
    ctx.busyRegister = true;
    var user = null;
    try {
      var res = await withTimeout(auth.createUserWithEmailAndPassword(email, pass), 25000, 'signup');
      user = res.user;
      try { await withTimeout(user.updateProfile({ displayName: name }), 8000, 'profile'); } catch (x) { console.warn('updateProfile', x); }
      withTimeout(db.collection(COL_USERS).doc(user.uid).set({
        name: name, email: email, phone: '', createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }), 15000, 'kc_users').catch(function (x) { console.error('kc_users write failed', x); });
      try { await sendVerificationMail(user); say(tx('email_verify_sent')); }
      catch (x) { console.warn('verification mail', x); showErr(x); }
      say(tx('ok_register'));
    } catch (err) { showErr(err); }
    finally { ctx.busyRegister = false; setBusy('kca-r-btn', false); }
    if (user) await rerunHandler();
  }

  async function onEmailLoginSubmit(e) {
    e.preventDefault(); setMsg('');
    var email = $('kca-e-email').value.trim(), pass = $('kca-e-pass').value;
    if (checkEmail(email).code === 'syntax') return showErr(tx('e_email'));
    if (!pass) return showErr(tx('e_pass'));
    setBusy('kca-e-btn', true);
    try { await withTimeout(auth.signInWithEmailAndPassword(email, pass), 25000, 'signin'); say(tx('ok_login')); }
    catch (err) { showErr(err); }
    finally { setBusy('kca-e-btn', false); }
  }

  async function onForgot() {
    var email = $('kca-e-email').value.trim();
    if (checkEmail(email).code === 'syntax') return showErr(tx('reset_need'));
    setAuthLang();
    try { await auth.sendPasswordResetEmail(email); } catch (err) { if (err && err.code !== 'auth/user-not-found') { showErr(err); return; } }
    setMsg(tx('reset_sent'), true);   // same message for unknown emails: no account enumeration
  }

  async function onResend() {
    var u = auth.currentUser; if (!u) return;
    setBusy('kca-v-resend', true);
    try { await sendVerificationMail(u); setMsg(tx('email_verify_sent'), true); }
    catch (err) { showErr(err); }
    finally { var b = $('kca-v-resend'); if (b) { b.disabled = false; b.textContent = tx('resend'); } tickResend(); }
  }

  async function onProfileSubmit(e) {
    e.preventDefault(); setMsg('');
    var u = auth.currentUser; if (!u) return;
    var name = $('kca-p-name').value.trim().replace(/\s+/g, ' '), email = $('kca-p-email').value.trim();
    if (name.length < 2 || name.length > 100) return showErr(tx('e_name'));
    var ee = emailError(email); if (ee) return showErr(ee);
    setBusy('kca-p-btn', true);
    try {
      try { await withTimeout(u.updateProfile({ displayName: name }), 8000, 'profile'); } catch (x) { console.warn(x); }
      await withTimeout(db.collection(COL_USERS).doc(u.uid).set({
        name: name, email: email.toLowerCase(), phone: u.phoneNumber || '', createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }), 15000, 'kc_users');
      say(tx('ok_register'));
      await rerunHandler();
    } catch (err) { showErr(err); }
    finally { setBusy('kca-p-btn', false); }
  }

  /* ---------------------------------------------------------------
   * 7. Google
   * ------------------------------------------------------------- */
  async function saveGoogleUserDoc(user) {
    var ref = db.collection(COL_USERS).doc(user.uid);
    var snap = await ref.get();
    if (!snap.exists) await ref.set({ name: user.displayName || '', email: user.email || '', phone: '', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  }
  async function googleSignIn() {
    setMsg('');
    var P = nativePlugin();
    try {
      if (P) {
        var r = await P.signInWithGoogle();
        var idToken = r && r.credential && r.credential.idToken;
        if (!idToken) throw { code: 'kca/no-id-token' };
        var res = await withTimeout(auth.signInWithCredential(
          firebase.auth.GoogleAuthProvider.credential(idToken, (r.credential && r.credential.accessToken) || null)), 25000, 'google');
        try { await saveGoogleUserDoc(res.user); } catch (e) { console.warn('google doc', e && e.code); }
        say(tx('ok_login'));
        return;
      }
      if (isNative()) { showErr('Google plugin missing in this build [FirebaseAuthentication not registered]'); return; }
      if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) { showErr(tx('e_pwa_google')); return; }
      var provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
        localStorage.setItem('kc_google_redirect_pending', '1');
        await auth.signInWithRedirect(provider); return;
      }
      var pr = await auth.signInWithPopup(provider);
      try { await saveGoogleUserDoc(pr.user); } catch (e) { console.warn('google doc', e && e.code); }
      say(tx('ok_login'));
    } catch (err) { showErr(err); }
  }
  async function handleGoogleRedirectResult() {
    if (!localStorage.getItem('kc_google_redirect_pending')) return;
    localStorage.removeItem('kc_google_redirect_pending');
    try {
      var r = await auth.getRedirectResult();
      if (r && r.user) { try { await saveGoogleUserDoc(r.user); } catch (e) { /* no-op */ } say(tx('ok_login')); }
    } catch (err) { showErr(err); }
  }

  function nativeSignOut() {
    var P = nativePlugin();
    if (P && typeof P.signOut === 'function') { try { P.signOut(); } catch (e) { /* no-op */ } }
  }
  async function useOtherAccount() {
    try { await auth.signOut(); } catch (e) { /* no-op */ }
    nativeSignOut();
    ctx.user = null;
    showStep('login');
  }

  /* ---------------------------------------------------------------
   * 8. hooks used by index.html's onAuthStateChanged
   * ------------------------------------------------------------- */
  var KCAuth = {
    Guard: Guard,
    isBusy: function () { return !!ctx.busyRegister; },
    isVerified: isVerified,
    needsProfile: function (user, doc) {
      var name = (doc && doc.name) || (user && user.displayName), email = (doc && doc.email) || (user && user.email);
      return !(name && email);
    },
    showVerifyEmail: function (user) { ctx.user = user || auth.currentUser; openGate('verifyemail'); },
    showProfile: function (user) {
      openGate('profile');
      var n = $('kca-p-name'), m = $('kca-p-email');
      if (n && !n.value && user && user.displayName) n.value = user.displayName;
      if (m && !m.value && user && user.email) m.value = user.email;
    },
    showLogin: function () {
      var g = gate();
      if (g && g.classList.contains('hide')) openGate('login');
      else if (g && (ctx.step === 'verifyemail' || ctx.step === 'profile')) showStep('login');
    },
    open: function (step) { openGate(step); },
    nativeSignOut: nativeSignOut,
    applyLang: applyLang,
    handleBack: function () {
      var g = gate(); if (!g || g.classList.contains('hide')) return false;
      if (ctx.step === 'register') { showStep('login'); return true; }
      return false;
    }
  };
  root.KCAuth = KCAuth;
  root.kcAuthHandleBack = KCAuth.handleBack;

  /* ---------------------------------------------------------------
   * 9. wiring
   * ------------------------------------------------------------- */
  function on(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }
  function bind() {
    var g = gate(); if (!g) return;
    on('kca-f-register', 'submit', onRegisterSubmit);
    on('kca-f-email-login', 'submit', onEmailLoginSubmit);
    on('kca-f-profile', 'submit', onProfileSubmit);
    on('kca-google-login', 'click', googleSignIn);
    on('kca-google-register', 'click', googleSignIn);
    on('kca-forgot', 'click', onForgot);
    on('kca-v-check', 'click', function () { setBusy('kca-v-check', true); checkVerified(false).finally(function () { setBusy('kca-v-check', false); }); });
    on('kca-v-resend', 'click', onResend);
    on('kca-v-other', 'click', useOtherAccount);
    on('kca-p-other', 'click', useOtherAccount);
    g.querySelectorAll('[data-kca-tab]').forEach(function (b) { b.addEventListener('click', function () { showStep(b.getAttribute('data-kca-tab')); }); });
    g.querySelectorAll('[data-kca-lang]').forEach(function (b) {
      b.addEventListener('click', function () { var l = b.getAttribute('data-kca-lang'); if (typeof setLang === 'function') setLang(l); else { localStorage.setItem('kc_lang', l); } applyLang(); });
    });
    // keyboard never hides the focused field
    g.addEventListener('focusin', function (e) {
      var t = e.target; if (!t || !/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      setTimeout(function () { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) { /* no-op */ } }, 320);
    });
    // coming back from the mail app: check right away
    document.addEventListener('visibilitychange', function () { if (!document.hidden && ctx.step === 'verifyemail' && !g.classList.contains('hide')) checkVerified(true); });
    applyLang();

    // keep the gate text in sync when the language is changed anywhere else in the app
    if (typeof root.setLang === 'function' && !root.setLang.__kca) {
      var orig = root.setLang;
      root.setLang = function () { var r = orig.apply(this, arguments); try { applyLang(); } catch (e) { /* no-op */ } return r; };
      root.setLang.__kca = true;
    }
    handleGoogleRedirectResult();

    // auth state arrived before this file did
    if (root._kcPendingVerifyUser) { var pu = root._kcPendingVerifyUser; root._kcPendingVerifyUser = null; KCAuth.showVerifyEmail(pu); }
    if (root._kcPendingProfileUser) { var pp = root._kcPendingProfileUser; root._kcPendingProfileUser = null; KCAuth.showProfile(pp); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})(typeof window !== 'undefined' ? window : globalThis);
