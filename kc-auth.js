/* ================================================================
 * KumbhConnect — kc-auth.js  (v1.7.0)
 * Login / Registration system:
 *   - Mobile OTP login (Firebase Phone Auth)
 *   - Google login (native Android via @capacitor-firebase/authentication, browser via popup/redirect)
 *   - Email + password login (existing accounts) — still needs a verified mobile number
 *   - Registration = name + email + password + mobile, mobile must be OTP-verified
 *   - Fake / disposable email blocking (client side, see Guard)
 *
 * Loaded AFTER the main inline script in index.html (needs: auth, db, COL_USERS, pdT-less own i18n,
 * toast, KCSecurity, kcIsNativeApp). Pure helpers (Guard) are exported for node tests.
 *
 * SECURITY NOTE: everything here runs in the browser and can be bypassed by a modified client.
 * Real enforcement = Firestore rules requiring request.auth.token.phone_number (see AUTH-SETUP.md).
 * ================================================================ */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------
   * 1. GUARD — email / phone validation (pure, no DOM, no Firebase)
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

  /** Returns E.164 string or null. Bare 10-digit numbers are treated as Indian mobiles. */
  function normalizePhone(raw) {
    var s = String(raw == null ? '' : raw).replace(/[\s\-().]/g, '');
    if (!s) return null;
    var out = null;
    if (/^\+\d{8,15}$/.test(s)) out = s;
    else if (/^00\d{8,15}$/.test(s)) out = '+' + s.slice(2);
    else if (/^0?[6-9]\d{9}$/.test(s)) out = '+91' + s.slice(-10);
    else if (/^91[6-9]\d{9}$/.test(s)) out = '+' + s;
    if (!out) return null;
    var digits = out.slice(1);
    if (/^(\d)\1+$/.test(digits.replace(/^91/, ''))) return null;                                  // 9999999999
    if (out.indexOf('+91') === 0 && !/^\+91[6-9]\d{9}$/.test(out)) return null;                   // invalid Indian mobile
    return out;
  }

  var Guard = { checkEmail: checkEmail, normalizePhone: normalizePhone, isDisposableDomain: function (d) { return !!DISPOSABLE[String(d).toLowerCase()]; } };
  if (typeof module !== 'undefined' && module.exports) { module.exports = { Guard: Guard }; }
  if (typeof document === 'undefined') { return; }   // node (tests) stops here

  /* ---------------------------------------------------------------
   * 2. TEXT (mr / hi / en)
   * ------------------------------------------------------------- */
  var T = {
    mr: {
      title: 'कुंभ कनेक्ट मध्ये स्वागत आहे', sub: 'सुरक्षित Login साठी तुमचा मोबाईल नंबर OTP ने verify केला जातो',
      tab_login: 'लॉगिन', tab_register: 'रजिस्ट्रेशन', lbl_mobile: 'मोबाईल नंबर', btn_send_otp: 'OTP पाठवा',
      or: 'किंवा', btn_google: 'Google ने पुढे जा', use_email_login: 'Email + Password ने Login करा', hide_email_login: 'Email Login लपवा',
      lbl_name: 'पूर्ण नाव', lbl_email: 'Email', lbl_pass: 'Password (किमान ८ अक्षरे)', lbl_pass_login: 'Password',
      ph_name: 'तुमचं नाव', btn_login: 'लॉगिन करा', forgot: 'पासवर्ड विसरलात?', btn_register: 'OTP पाठवून रजिस्टर करा',
      otp_title: 'OTP टाका', otp_sent: 'हा ६ अंकी कोड {p} वर पाठवला आहे', btn_verify: 'Verify करा', resend: 'पुन्हा OTP पाठवा',
      resend_in: 'पुन्हा पाठवा ({s}s)', change_number: 'नंबर बदला',
      link_title: 'मोबाईल नंबर Verify करा', link_sub: 'सुरक्षेसाठी प्रत्येक खात्याला OTP ने verify केलेला मोबाईल नंबर लागतो.',
      profile_title: 'प्रोफाइल पूर्ण करा', profile_sub: 'नाव आणि Email टाका', btn_save: 'सेव्ह करा आणि पुढे जा',
      other_account: 'दुसऱ्या खात्याने Login करा', terms: 'पुढे गेल्यावर तुम्ही आमच्या <a href="terms.html">अटी</a> आणि <a href="privacy-policy.html">गोपनीयता धोरण</a> मान्य करता.',
      wait: 'कृपया थांबा…', ok_login: 'Login यशस्वी ✅', ok_register: 'रजिस्ट्रेशन पूर्ण झाले ✅', ok_verified: 'मोबाईल नंबर verify झाला ✅',
      e_name: 'कृपया तुमचं पूर्ण नाव टाका', e_email: 'योग्य Email टाका', e_pass8: 'Password किमान ८ अक्षरांचा हवा', e_pass: 'Password टाका',
      e_phone: 'योग्य १० अंकी मोबाईल नंबर टाका (उदा. 9876543210)', e_otp: 'सहा अंकी OTP टाका',
      e_disposable: 'Temporary / Fake Email चालत नाही. तुमचा खरा Email वापरा.', e_fake: 'हा Email खरा वाटत नाही. तुमचा खरा Email टाका.',
      e_typo: 'Email चुकीचा वाटतो. तुम्हाला "{s}" म्हणायचं आहे का?', e_network: 'इंटरनेट/नेटवर्क समस्या — पुन्हा प्रयत्न करा',
      e_wrong_cred: 'Email किंवा Password चुकीचा आहे', e_email_used: 'हा Email आधीच वापरात आहे — Login करा किंवा पासवर्ड रीसेट करा',
      e_bad_code: 'OTP चुकीचा आहे', e_code_expired: 'OTP ची मुदत संपली — नवीन OTP मागवा', e_too_many: 'खूप प्रयत्न झाले — थोड्या वेळाने पुन्हा करा',
      e_phone_used: 'हा मोबाईल नंबर आधीच दुसऱ्या खात्याला जोडलेला आहे', e_phone_fmt: 'मोबाईल नंबर योग्य नाही',
      e_sms_fail: 'OTP पाठवता आला नाही. नंबर तपासा किंवा थोड्या वेळाने पुन्हा प्रयत्न करा', e_timeout: 'OTP आला नाही — पुन्हा प्रयत्न करा',
      e_google: 'Google Login होऊ शकला नाही — पुन्हा प्रयत्न करा', e_google_cancel: 'Google Login रद्द केले',
      e_generic: 'काहीतरी चुकलं — पुन्हा प्रयत्न करा', e_pwa_google: 'Google Login इन्स्टॉल केलेल्या PWA मध्ये चालत नाही — Mobile OTP वापरा',
      e_not_enabled: 'Firebase मध्ये हा Login प्रकार चालू नाही (Console → Authentication → Sign-in method)', e_domain: 'ही साईट Firebase Authorized domains मध्ये नाही',
      e_blocked_key: 'Firebase API key ने विनंती ब्लॉक केली (Google Cloud → API key restrictions तपासा)', e_app_check: 'App verification अयशस्वी — ॲप अपडेट करा',
      reset_sent: 'हा Email नोंदणीकृत असल्यास Password reset link पाठवला आहे', reset_need: 'आधी तुमचा Email टाका', email_verify_sent: 'Email verify करण्यासाठी link पाठवली आहे'
    },
    hi: {
      title: 'कुंभ कनेक्ट में स्वागत है', sub: 'सुरक्षित Login के लिए आपका मोबाइल नंबर OTP से verify किया जाता है',
      tab_login: 'लॉगिन', tab_register: 'रजिस्ट्रेशन', lbl_mobile: 'मोबाइल नंबर', btn_send_otp: 'OTP भेजें',
      or: 'या', btn_google: 'Google से आगे बढ़ें', use_email_login: 'Email + Password से Login करें', hide_email_login: 'Email Login छिपाएँ',
      lbl_name: 'पूरा नाम', lbl_email: 'Email', lbl_pass: 'Password (कम से कम 8 अक्षर)', lbl_pass_login: 'Password',
      ph_name: 'आपका नाम', btn_login: 'लॉगिन करें', forgot: 'पासवर्ड भूल गए?', btn_register: 'OTP भेजकर रजिस्टर करें',
      otp_title: 'OTP डालें', otp_sent: 'यह 6 अंकों का कोड {p} पर भेजा गया है', btn_verify: 'Verify करें', resend: 'OTP दोबारा भेजें',
      resend_in: 'दोबारा भेजें ({s}s)', change_number: 'नंबर बदलें',
      link_title: 'मोबाइल नंबर Verify करें', link_sub: 'सुरक्षा के लिए हर खाते में OTP से verify किया हुआ मोबाइल नंबर ज़रूरी है।',
      profile_title: 'प्रोफ़ाइल पूरी करें', profile_sub: 'नाम और Email डालें', btn_save: 'सेव करें और आगे बढ़ें',
      other_account: 'दूसरे खाते से Login करें', terms: 'आगे बढ़ने पर आप हमारी <a href="terms.html">शर्तें</a> और <a href="privacy-policy.html">गोपनीयता नीति</a> मानते हैं।',
      wait: 'कृपया प्रतीक्षा करें…', ok_login: 'Login सफल ✅', ok_register: 'रजिस्ट्रेशन पूरा हुआ ✅', ok_verified: 'मोबाइल नंबर verify हो गया ✅',
      e_name: 'कृपया अपना पूरा नाम डालें', e_email: 'सही Email डालें', e_pass8: 'Password कम से कम 8 अक्षर का हो', e_pass: 'Password डालें',
      e_phone: 'सही 10 अंकों का मोबाइल नंबर डालें (जैसे 9876543210)', e_otp: '6 अंकों का OTP डालें',
      e_disposable: 'Temporary / Fake Email मान्य नहीं है। अपना असली Email इस्तेमाल करें।', e_fake: 'यह Email असली नहीं लगता। अपना असली Email डालें।',
      e_typo: 'Email गलत लगता है। क्या आपका मतलब "{s}" है?', e_network: 'इंटरनेट/नेटवर्क समस्या — दोबारा कोशिश करें',
      e_wrong_cred: 'Email या Password गलत है', e_email_used: 'यह Email पहले से इस्तेमाल में है — Login करें या पासवर्ड रीसेट करें',
      e_bad_code: 'OTP गलत है', e_code_expired: 'OTP की अवधि समाप्त — नया OTP मँगाएँ', e_too_many: 'बहुत प्रयास हो गए — थोड़ी देर बाद करें',
      e_phone_used: 'यह मोबाइल नंबर पहले से किसी दूसरे खाते से जुड़ा है', e_phone_fmt: 'मोबाइल नंबर सही नहीं है',
      e_sms_fail: 'OTP नहीं भेजा जा सका। नंबर जाँचें या थोड़ी देर बाद कोशिश करें', e_timeout: 'OTP नहीं आया — दोबारा कोशिश करें',
      e_google: 'Google Login नहीं हो सका — दोबारा कोशिश करें', e_google_cancel: 'Google Login रद्द किया गया',
      e_generic: 'कुछ गड़बड़ हुई — दोबारा कोशिश करें', e_pwa_google: 'Google Login इंस्टॉल किए गए PWA में नहीं चलता — Mobile OTP इस्तेमाल करें',
      e_not_enabled: 'Firebase में यह Login तरीका चालू नहीं है (Console → Authentication → Sign-in method)', e_domain: 'यह साइट Firebase Authorized domains में नहीं है',
      e_blocked_key: 'Firebase API key ने अनुरोध रोका (Google Cloud → API key restrictions जाँचें)', e_app_check: 'App verification विफल — ऐप अपडेट करें',
      reset_sent: 'यह Email पंजीकृत हो तो Password reset link भेजा गया है', reset_need: 'पहले अपना Email डालें', email_verify_sent: 'Email verify करने के लिए link भेजा गया है'
    },
    en: {
      title: 'Welcome to KumbhConnect', sub: 'For a secure login, your mobile number is verified with an OTP',
      tab_login: 'Login', tab_register: 'Register', lbl_mobile: 'Mobile number', btn_send_otp: 'Send OTP',
      or: 'or', btn_google: 'Continue with Google', use_email_login: 'Login with Email + Password', hide_email_login: 'Hide Email login',
      lbl_name: 'Full name', lbl_email: 'Email', lbl_pass: 'Password (min. 8 characters)', lbl_pass_login: 'Password',
      ph_name: 'Your name', btn_login: 'Login', forgot: 'Forgot password?', btn_register: 'Send OTP & Register',
      otp_title: 'Enter OTP', otp_sent: 'A 6-digit code was sent to {p}', btn_verify: 'Verify', resend: 'Resend OTP',
      resend_in: 'Resend in {s}s', change_number: 'Change number',
      link_title: 'Verify your mobile number', link_sub: 'For safety, every account needs a mobile number verified by OTP.',
      profile_title: 'Complete your profile', profile_sub: 'Enter your name and email', btn_save: 'Save & continue',
      other_account: 'Login with another account', terms: 'By continuing you accept our <a href="terms.html">Terms</a> and <a href="privacy-policy.html">Privacy Policy</a>.',
      wait: 'Please wait…', ok_login: 'Logged in ✅', ok_register: 'Registration complete ✅', ok_verified: 'Mobile number verified ✅',
      e_name: 'Please enter your full name', e_email: 'Enter a valid email', e_pass8: 'Password must be at least 8 characters', e_pass: 'Enter your password',
      e_phone: 'Enter a valid 10-digit mobile number (e.g. 9876543210)', e_otp: 'Enter the 6-digit OTP',
      e_disposable: 'Temporary / fake email addresses are not allowed. Use your real email.', e_fake: 'This email does not look real. Enter your real email.',
      e_typo: 'This email looks mistyped. Did you mean "{s}"?', e_network: 'Network problem — please try again',
      e_wrong_cred: 'Wrong email or password', e_email_used: 'This email is already in use — log in or reset your password',
      e_bad_code: 'Wrong OTP', e_code_expired: 'OTP expired — request a new one', e_too_many: 'Too many attempts — try again later',
      e_phone_used: 'This mobile number is already linked to another account', e_phone_fmt: 'Mobile number is not valid',
      e_sms_fail: 'Could not send the OTP. Check the number or try again shortly', e_timeout: 'OTP did not arrive — try again',
      e_google: 'Google login failed — please try again', e_google_cancel: 'Google login cancelled',
      e_generic: 'Something went wrong — please try again', e_pwa_google: 'Google login does not work in an installed PWA — use Mobile OTP',
      e_not_enabled: 'This sign-in method is not enabled in Firebase (Console → Authentication → Sign-in method)', e_domain: 'This site is not in Firebase Authorized domains',
      e_blocked_key: 'Firebase API key blocked the request (check Google Cloud → API key restrictions)', e_app_check: 'App verification failed — please update the app',
      reset_sent: 'If this email is registered, a password reset link has been sent', reset_need: 'Enter your email first', email_verify_sent: 'A verification link was sent to your email'
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
  var ctx = { mode: null, phone: null, vid: null, pending: null, step: 'login', prev: 'login', busy: false, tries: 0 };
  var resendTimer = null, lastSendAt = 0;

  function withTimeout(p, ms, label) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej({ code: 'kca/timeout', message: label + ' timeout' }); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  function nativePlugin() {
    try {
      var C = root.Capacitor;
      if (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() &&
          (typeof C.isPluginAvailable !== 'function' || C.isPluginAvailable('FirebaseAuthentication'))) {
        return (C.Plugins && C.Plugins.FirebaseAuthentication) || null;
      }
    } catch (e) { /* fall through */ }
    return null;
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
      'auth/invalid-credential': 'e_wrong_cred', 'auth/wrong-password': 'e_wrong_cred', 'auth/user-not-found': 'e_wrong_cred', 'auth/invalid-email': 'e_email',
      'auth/email-already-in-use': 'e_email_used', 'auth/weak-password': 'e_pass8',
      'auth/invalid-verification-code': 'e_bad_code', 'auth/code-expired': 'e_code_expired', 'auth/session-expired': 'e_code_expired',
      'auth/invalid-verification-id': 'e_code_expired', 'auth/missing-verification-code': 'e_otp',
      'auth/too-many-requests': 'e_too_many', 'auth/quota-exceeded': 'e_too_many',
      'auth/credential-already-in-use': 'e_phone_used', 'auth/account-exists-with-different-credential': 'e_email_used',
      'auth/invalid-phone-number': 'e_phone_fmt', 'auth/missing-phone-number': 'e_phone_fmt',
      'auth/network-request-failed': 'e_network', 'auth/operation-not-allowed': 'e_not_enabled', 'auth/unauthorized-domain': 'e_domain',
      'auth/captcha-check-failed': 'e_app_check', 'auth/missing-client-identifier': 'e_app_check', 'auth/app-not-authorized': 'e_app_check',
      'auth/popup-closed-by-user': 'e_google_cancel', 'auth/cancelled-popup-request': null,
      'kca/timeout': 'e_timeout', 'kca/phone-failed': 'e_sms_fail', 'kca/no-id-token': 'e_google'
    };
    if (c in m) return m[c] ? tx(m[c]) : '';
    if (/referer|api[-_ ]key/i.test(c + ' ' + (err && err.message || ''))) return tx('e_blocked_key');
    if (err && /cancel/i.test(String(err.message || err.code || ''))) return tx('e_google_cancel');
    try { console.error('[KCAuth]', err); } catch (e) { /* no-op */ }
    return tx('e_generic') + (c ? ' [' + c + ']' : '');
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
    var em = $('kca-toggle-email'), f = $('kca-f-email-login');
    if (em && f) em.textContent = tx(f.hidden ? 'use_email_login' : 'hide_email_login');
    updateOtpHeader(); tickResend(true);
  }

  function showStep(step) {
    ctx.prev = ctx.step; ctx.step = step;
    var g = gate(); if (!g) return;
    g.querySelectorAll('.kca-step').forEach(function (s) { s.classList.toggle('on', s.getAttribute('data-step') === step); });
    var tabs = $('kca-tabs');
    if (tabs) {
      var showTabs = step === 'login' || step === 'register';
      tabs.hidden = !showTabs;
      tabs.querySelectorAll('.kca-tab').forEach(function (t) {
        var on = t.getAttribute('data-kca-tab') === step; t.classList.toggle('on', on); t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    setMsg('');
    g.scrollTop = 0;
    var first = g.querySelector('.kca-step.on input:not([type=hidden])');
    if (first && step !== 'otp') { /* no autofocus: avoids keyboard covering the form on open */ }
    if (step === 'otp') { var o = $('kca-otp'); if (o) setTimeout(function () { try { o.focus(); } catch (e) { /* no-op */ } }, 250); }
  }
  function openGate(step) { var g = gate(); if (!g) return; g.classList.remove('hide'); applyLang(); showStep(step || 'login'); }

  function updateOtpHeader() {
    var el = $('kca-otp-to'); if (el && ctx.phone) el.textContent = tx('otp_sent', { p: ctx.phone });
  }
  function tickResend(rerenderOnly) {
    var b = $('kca-resend'); if (!b) return;
    var left = Math.max(0, 30 - Math.floor((Date.now() - lastSendAt) / 1000));
    if (left > 0) { b.disabled = true; b.textContent = tx('resend_in', { s: left }); if (!rerenderOnly) resendTimer = setTimeout(tickResend, 1000); else { clearTimeout(resendTimer); resendTimer = setTimeout(tickResend, 1000); } }
    else { b.disabled = false; b.textContent = tx('resend'); }
  }

  /* ---------------------------------------------------------------
   * 5. phone OTP transport (native plugin or web reCAPTCHA)
   * ------------------------------------------------------------- */
  var webVerifier = null;
  function getWebVerifier() {
    if (webVerifier) return webVerifier;
    var holder = $('kca-recaptcha'); if (holder) holder.innerHTML = '';
    webVerifier = new firebase.auth.RecaptchaVerifier('kca-recaptcha', { size: 'invisible' });
    return webVerifier;
  }
  function resetWebVerifier() { try { if (webVerifier) webVerifier.clear(); } catch (e) { /* no-op */ } webVerifier = null; }

  function sendCodeNative(P, phone) {
    return new Promise(function (resolve, reject) {
      var handles = [], done = false, timer;
      function finish(fn, v) { if (done) return; done = true; clearTimeout(timer); handles.forEach(function (h) { try { h && h.remove && h.remove(); } catch (e) { /* no-op */ } }); fn(v); }
      timer = setTimeout(function () { finish(reject, { code: 'kca/timeout' }); }, 70000);
      (async function () {
        try {
          handles.push(await P.addListener('phoneCodeSent', function (e) { finish(resolve, e && e.verificationId); }));
          handles.push(await P.addListener('phoneVerificationFailed', function (e) { finish(reject, { code: (e && e.code) || 'kca/phone-failed', message: e && e.message }); }));
          await P.signInWithPhoneNumber({ phoneNumber: phone });
        } catch (err) { finish(reject, err); }
      })();
    });
  }
  async function sendCode(phone) {
    var P = nativePlugin();
    if (P) return sendCodeNative(P, phone);
    try { auth.languageCode = ({ mr: 'mr', hi: 'hi', en: 'en' })[lang()] || 'en'; } catch (e) { /* no-op */ }
    try {
      return await withTimeout(new firebase.auth.PhoneAuthProvider(auth).verifyPhoneNumber(phone, getWebVerifier()), 60000, 'sms');
    } catch (e) { resetWebVerifier(); throw e; }
  }

  async function startOtp(mode, phone, pending) {
    if (Date.now() - lastSendAt < 30000 && ctx.phone === phone && ctx.vid) { showStep('otp'); updateOtpHeader(); tickResend(); return; }
    ctx.mode = mode; ctx.pending = pending || null;
    var btnId = ({ login: 'kca-l-send', register: 'kca-r-send', link: 'kca-k-send' })[mode];
    setBusy(btnId, true);
    try {
      ctx.vid = await sendCode(phone);
      if (!ctx.vid) throw { code: 'kca/phone-failed' };
      ctx.phone = phone; ctx.tries = 0; lastSendAt = Date.now();
      var o = $('kca-otp'); if (o) o.value = '';
      showStep('otp'); updateOtpHeader(); tickResend();
    } catch (err) { showErr(err); }
    finally { setBusy(btnId, false); }
  }

  async function verifyOtp() {
    if (ctx.busy) return;
    var code = ($('kca-otp').value || '').replace(/\D/g, '');
    if (code.length !== 6) { showErr(tx('e_otp')); return; }
    if (!ctx.vid) { showErr(tx('e_code_expired')); return; }
    ctx.busy = true; setBusy('kca-otp-btn', true);
    try {
      var cred = firebase.auth.PhoneAuthProvider.credential(ctx.vid, code);
      if (ctx.mode === 'login') await finishLogin(cred);
      else if (ctx.mode === 'register') await finishRegister(cred);
      else await finishLink(cred);
    } catch (err) {
      ctx.tries++;
      var c = err && err.code;
      if (c === 'auth/code-expired' || c === 'auth/invalid-verification-id' || c === 'auth/session-expired' || ctx.tries >= 5) { ctx.vid = null; lastSendAt = 0; tickResend(); }
      showErr(err);
    } finally { ctx.busy = false; setBusy('kca-otp-btn', false); }
  }

  async function rerunHandler() {
    if (typeof kcHandleAuthUser === 'function') { try { await kcHandleAuthUser(auth.currentUser); } catch (e) { console.error(e); } }
  }

  /* ---- mode: login (phone OTP) ---- */
  async function finishLogin(cred) {
    await withTimeout(auth.signInWithCredential(cred), 25000, 'signin');
    say(tx('ok_login'));                       // onAuthStateChanged decides: app, or profile step for brand-new numbers
  }

  /* ---- mode: register (OTP first, then attach email+password to the verified phone account) ---- */
  async function finishRegister(cred) {
    var p = ctx.pending; if (!p) throw { code: 'kca/timeout' };
    ctx.busyRegister = true;
    var res, created = false;
    try {
      res = await withTimeout(auth.signInWithCredential(cred), 25000, 'signin');
      created = !!(res.additionalUserInfo && res.additionalUserInfo.isNewUser);
      var user = res.user;
      try {
        await withTimeout(user.linkWithCredential(firebase.auth.EmailAuthProvider.credential(p.email, p.pass)), 25000, 'link');
      } catch (linkErr) {
        // Do not leave an orphan phone-only account behind when the email can't be attached.
        if (created) { try { await user.delete(); } catch (e) { try { await auth.signOut(); } catch (e2) { /* no-op */ } } }
        else { try { await auth.signOut(); } catch (e3) { /* no-op */ } }
        throw linkErr;
      }
      try { await withTimeout(user.updateProfile({ displayName: p.name }), 8000, 'profile'); } catch (e) { console.warn('updateProfile', e); }
      withTimeout(db.collection(COL_USERS).doc(user.uid).set({
        name: p.name, email: p.email, phone: ctx.phone, phoneVerified: true, createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }), 15000, 'kc_users').catch(function (e) { console.error('kc_users write failed', e); });
      user.sendEmailVerification().then(function () { say(tx('email_verify_sent')); }).catch(function () { /* best effort */ });
      say(tx('ok_register'));
    } finally { ctx.busyRegister = false; }
    ctx.pending = null;
    await rerunHandler();
  }

  /* ---- mode: link (Google / email users without a verified phone) ---- */
  async function finishLink(cred) {
    var u = auth.currentUser; if (!u) throw { code: 'kca/timeout' };
    await withTimeout(u.linkWithCredential(cred), 25000, 'link');
    try { await u.reload(); } catch (e) { /* no-op */ }
    withTimeout(db.collection(COL_USERS).doc(u.uid).set({ phone: ctx.phone, phoneVerified: true }, { merge: true }), 15000, 'kc_users')
      .catch(function (e) { console.warn('phone not mirrored to kc_users', e && e.code); });
    say(tx('ok_verified'));
    await rerunHandler();
  }

  /* ---------------------------------------------------------------
   * 6. form handlers
   * ------------------------------------------------------------- */
  function phoneFrom(id) { var p = normalizePhone($(id).value); if (!p) { showErr(tx('e_phone')); return null; } return p; }

  function onLoginPhoneSubmit(e) { e.preventDefault(); setMsg(''); var p = phoneFrom('kca-l-phone'); if (p) startOtp('login', p); }
  function onLinkPhoneSubmit(e) { e.preventDefault(); setMsg(''); var p = phoneFrom('kca-k-phone'); if (p) startOtp('link', p); }

  function onRegisterSubmit(e) {
    e.preventDefault(); setMsg('');
    var name = $('kca-r-name').value.trim().replace(/\s+/g, ' ');
    var email = $('kca-r-email').value.trim();
    var pass = $('kca-r-pass').value;
    if (name.length < 2 || name.length > 100) return showErr(tx('e_name'));
    var ee = emailError(email); if (ee) return showErr(ee);
    if (pass.length < 8) return showErr(tx('e_pass8'));
    var p = phoneFrom('kca-r-phone'); if (!p) return;
    startOtp('register', p, { name: name, email: email.toLowerCase(), pass: pass });
  }

  async function onEmailLoginSubmit(e) {
    e.preventDefault(); setMsg('');
    var email = $('kca-e-email').value.trim(), pass = $('kca-e-pass').value;
    if (!checkEmail(email).ok && checkEmail(email).code === 'syntax') return showErr(tx('e_email'));
    if (!pass) return showErr(tx('e_pass'));
    setBusy('kca-e-btn', true);
    try { await withTimeout(auth.signInWithEmailAndPassword(email, pass), 25000, 'signin'); say(tx('ok_login')); }
    catch (err) { showErr(err); }
    finally { setBusy('kca-e-btn', false); }
  }

  async function onForgot() {
    var email = $('kca-e-email').value.trim();
    if (!checkEmail(email).ok && checkEmail(email).code === 'syntax') return showErr(tx('reset_need'));
    try { auth.languageCode = ({ mr: 'mr', hi: 'hi', en: 'en' })[lang()] || 'en'; } catch (e) { /* no-op */ }
    try { await auth.sendPasswordResetEmail(email); } catch (err) { if (err && err.code !== 'auth/user-not-found') { showErr(err); return; } }
    setMsg(tx('reset_sent'), true);   // same message for unknown emails: no account enumeration
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
        name: name, email: email.toLowerCase(), phone: u.phoneNumber || '', phoneVerified: !!u.phoneNumber,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }), 15000, 'kc_users');
      say(tx('ok_register'));
      await rerunHandler();
    } catch (err) { showErr(err); }
    finally { setBusy('kca-p-btn', false); }
  }

  /* ---- Google ---- */
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
        var res = await withTimeout(auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(idToken, (r.credential && r.credential.accessToken) || null)), 25000, 'google');
        try { await saveGoogleUserDoc(res.user); } catch (e) { console.warn('google doc', e && e.code); }
        say(tx('ok_login'));
        return;
      }
      if (isNative()) { showErr(tx('e_google')); return; }          // native build without the plugin: never try OAuth in a WebView
      if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) { showErr(tx('e_pwa_google')); return; }
      var provider = new firebase.auth.GoogleAuthProvider();
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

  async function useOtherAccount() {
    ctx.vid = null; ctx.pending = null;
    try { await auth.signOut(); } catch (e) { /* no-op */ }
    nativeSignOut();
    showStep('login');
  }
  function nativeSignOut() {
    var P = nativePlugin();
    if (P && typeof P.signOut === 'function') { try { P.signOut(); } catch (e) { /* no-op */ } }
  }

  /* ---------------------------------------------------------------
   * 7. hooks used by index.html's onAuthStateChanged
   * ------------------------------------------------------------- */
  var KCAuth = {
    Guard: Guard,
    isBusy: function () { return !!ctx.busyRegister; },
    isVerified: function (user) { return !!(user && user.phoneNumber); },
    needsProfile: function (user, doc) {
      var name = (doc && doc.name) || (user && user.displayName), email = (doc && doc.email) || (user && user.email);
      return !(name && email);
    },
    showLinkPhone: function (user) { openGate('linkphone'); },
    showProfile: function (user) {
      openGate('profile');
      var n = $('kca-p-name'), m = $('kca-p-email');
      if (n && !n.value && user && user.displayName) n.value = user.displayName;
      if (m && !m.value && user && user.email) m.value = user.email;
    },
    showLogin: function () { var g = gate(); if (g && g.classList.contains('hide')) openGate('login'); else if (g && (ctx.step === 'linkphone' || ctx.step === 'profile')) showStep('login'); },
    open: function (step) { openGate(step); },
    nativeSignOut: nativeSignOut,
    applyLang: applyLang,
    handleBack: function () {
      var g = gate(); if (!g || g.classList.contains('hide')) return false;
      if (ctx.step === 'otp') { showStep(ctx.mode === 'link' ? 'linkphone' : (ctx.mode === 'register' ? 'register' : 'login')); return true; }
      if (ctx.step === 'register') { showStep('login'); return true; }
      return false;
    }
  };
  root.KCAuth = KCAuth;
  root.kcAuthHandleBack = KCAuth.handleBack;

  /* ---------------------------------------------------------------
   * 8. wiring
   * ------------------------------------------------------------- */
  function on(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }
  function bind() {
    var g = gate(); if (!g) return;
    on('kca-f-phone-login', 'submit', onLoginPhoneSubmit);
    on('kca-f-register', 'submit', onRegisterSubmit);
    on('kca-f-email-login', 'submit', onEmailLoginSubmit);
    on('kca-f-otp', 'submit', function (e) { e.preventDefault(); verifyOtp(); });
    on('kca-f-link', 'submit', onLinkPhoneSubmit);
    on('kca-f-profile', 'submit', onProfileSubmit);
    on('kca-google-login', 'click', googleSignIn);
    on('kca-google-register', 'click', googleSignIn);
    on('kca-forgot', 'click', onForgot);
    on('kca-resend', 'click', function () {
      if (!ctx.phone) return; lastSendAt = 0; ctx.vid = null;
      startOtp(ctx.mode, ctx.phone, ctx.pending);
    });
    on('kca-change', 'click', function () { showStep(ctx.mode === 'link' ? 'linkphone' : (ctx.mode === 'register' ? 'register' : 'login')); });
    on('kca-k-other', 'click', useOtherAccount);
    on('kca-p-other', 'click', useOtherAccount);
    on('kca-toggle-email', 'click', function () {
      var f = $('kca-f-email-login'); f.hidden = !f.hidden; applyLang();
      if (!f.hidden) try { f.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* no-op */ }
    });
    g.querySelectorAll('[data-kca-tab]').forEach(function (b) { b.addEventListener('click', function () { showStep(b.getAttribute('data-kca-tab')); }); });
    g.querySelectorAll('[data-kca-lang]').forEach(function (b) {
      b.addEventListener('click', function () { var l = b.getAttribute('data-kca-lang'); if (typeof setLang === 'function') setLang(l); else { localStorage.setItem('kc_lang', l); } applyLang(); });
    });
    var otp = $('kca-otp');
    if (otp) otp.addEventListener('input', function () {
      otp.value = otp.value.replace(/\D/g, '').slice(0, 6);
      if (otp.value.length === 6 && !ctx.busy) verifyOtp();
    });
    // numeric-only phone inputs, keyboard never hides the focused field
    ['kca-l-phone', 'kca-r-phone', 'kca-k-phone'].forEach(function (id) {
      var el = $(id); if (el) el.addEventListener('input', function () { el.value = el.value.replace(/[^\d+\s\-]/g, ''); });
    });
    g.addEventListener('focusin', function (e) {
      var t = e.target; if (!t || !/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      setTimeout(function () { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) { /* no-op */ } }, 320);
    });
    applyLang();

    // keep the gate text in sync when the language is changed anywhere else in the app
    if (typeof root.setLang === 'function' && !root.setLang.__kca) {
      var orig = root.setLang;
      root.setLang = function () { var r = orig.apply(this, arguments); try { applyLang(); } catch (e) { /* no-op */ } return r; };
      root.setLang.__kca = true;
    }
    handleGoogleRedirectResult();

    // auth state arrived before this file did
    if (root._kcPendingVerifyUser) { var pu = root._kcPendingVerifyUser; root._kcPendingVerifyUser = null; KCAuth.showLinkPhone(pu); }
    if (root._kcPendingProfileUser) { var pp = root._kcPendingProfileUser; root._kcPendingProfileUser = null; KCAuth.showProfile(pp); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})(typeof window !== 'undefined' ? window : globalThis);
