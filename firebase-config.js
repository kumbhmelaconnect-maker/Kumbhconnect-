

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAalB6MNHErCJmERYk9GMOG_4DLQYRp2Kw",
  authDomain: "kumbh-connect-e308e.firebaseapp.com",
  projectId: "kumbh-connect-e308e",
  storageBucket: "kumbh-connect-e308e.firebasestorage.app",
  messagingSenderId: "530817902202",
  appId: "1:530817902202:web:e26dc92b065313b111bdc3"
};

const CLOUDINARY_CONFIG = {
  cloudName: "fzntl3lv",
  uploadPreset: "Kumbh Connect"
};

/* =============================================================================
   AUDIT REVISION — what changed vs. the original file (values above are
   byte-for-byte unchanged; see AUDIT_REPORT.md findings F-10, F-11, F-13):
   1. Firebase init is idempotent (a second load/include no longer throws
      "Firebase App named '[DEFAULT]' already exists").
   2. Optional App Check activation. It does NOTHING unless the page defines
      window.KC_APPCHECK_SITE_KEY (your reCAPTCHA site key) AND loads
      firebase-app-check-compat.js. No key is invented here.
   3. uploadToCloudinary(): same name / same return value (secure_url), plus
      client-side type + size + timeout checks and a check that the returned
      URL has the exact shape firestore.rules accepts.
   CLIENT vs ENFORCED: everything in this file runs in the browser and can be
   bypassed by a determined user. What actually protects data is
   firestore.rules (enforced by Firebase), App Check ENFORCEMENT (a console
   setting — not verifiable from source), and the Cloudinary upload-preset
   restrictions (a Cloudinary console setting — not verifiable from source).
   ============================================================================= */

/* ===== Firebase init (compat SDK — index.html मध्ये स्क्रिप्ट टॅगने आधीच लोड केलेली असते) ===== */
const _kcFirebaseApp = (firebase.apps && firebase.apps.length)
  ? firebase.app()
  : firebase.initializeApp(FIREBASE_CONFIG);

/* ===== Optional App Check (opt-in; safe no-op by default) =====
   To enable: (1) create a reCAPTCHA v3 / Enterprise key and register the app in
   Firebase console > App Check, (2) add
   <script src="https://www.gstatic.com/firebasejs/10.13.1/firebase-app-check-compat.js"></script>
   after firebase-app-check... i.e. after firebase-app-compat.js and BEFORE this file, and
   <script>window.KC_APPCHECK_SITE_KEY = 'YOUR_PUBLIC_SITE_KEY';</script> before this file,
   (3) watch App Check metrics for several days, THEN turn on enforcement
   for Firestore. Enforcing before clients send tokens locks real users out. */
(function activateAppCheck(){
  try {
    const siteKey = (typeof window !== 'undefined') ? window.KC_APPCHECK_SITE_KEY : undefined;
    if (!siteKey || typeof firebase.appCheck !== 'function') return;
    firebase.appCheck().activate(siteKey, true); // true = auto-refresh tokens
  } catch (e) {
    console.warn('[KC] App Check could not be activated');
  }
})();

const db = firebase.firestore();
const auth = firebase.auth();
/* LOCAL is already Firebase's own default (persists sign-in across app
   restarts on the same device/browser via IndexedDB), but it's set
   explicitly here as a safety net — some Android WebView/PWA-wrapper
   setups behave inconsistently with a purely implicit default. This
   does NOT fix a wrapper that clears its own storage between launches
   (that's a packaging setting outside this file); it only guarantees
   the app itself always asks for the persistent mode. */
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});

/* ===== Cloudinary अपलोड हेल्पर — File ऑब्जेक्ट घेऊन secure_url परत देतो ===== */
/* Client-side backstops (the page UI already limits photos to 5 MB; this is
   a second line of defence for other callers such as the ad-creative upload).
   A malicious user can call Cloudinary directly with the public cloud name +
   preset — the REAL control is the preset's own restrictions in the
   Cloudinary console (allowed formats, max file size, folder, moderation). */
const KC_UPLOAD_LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,   // generous backstop; UI enforces 5 MB for listing photos
  timeoutMs: 60000
});
async function uploadToCloudinary(file){
  if (!file || typeof file.size !== 'number' || typeof file.type !== 'string') {
    throw new Error('Upload rejected: not a file');
  }
  if (!/^image\//.test(file.type) || file.type === 'image/svg+xml') {
    throw new Error('Upload rejected: unsupported file type');
  }
  if (file.size <= 0 || file.size > KC_UPLOAD_LIMITS.maxBytes) {
    throw new Error('Upload rejected: file size');
  }
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), KC_UPLOAD_LIMITS.timeoutMs);
  try {
    const res = await fetch(url, { method:'POST', body:fd, signal: ctrl.signal });
    if(!res.ok){ throw new Error('Cloudinary upload failed: ' + res.status); }
    const data = await res.json();
    const out = data && data.secure_url;
    // Same shape firestore.rules requires (isValidPhotoUrl / isValidAdCreativeUrl):
    // fail here with a clear error instead of a confusing permission-denied later.
    const okShape = typeof out === 'string' && out.length <= 300 &&
      new RegExp('^https://res\\.cloudinary\\.com/' + CLOUDINARY_CONFIG.cloudName + '/image/upload/[A-Za-z0-9/_.-]+$').test(out);
    if (!okShape) { throw new Error('Cloudinary upload failed: unexpected response'); }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/* ===== कॉमन Firestore कलेक्शन नावं — दोन्ही फाईल्समध्ये सेम ठेवा ===== */
const COL_PHOTOS  = 'mc_photos';   // सर्व फोटो: previous / live / govt / guide / user — status: pending/approved
const COL_PRESS   = 'mc_press';    // प्रेस रिलीज
const COL_DEPTS   = 'mc_departments';    // विभाग (सार्वजनिक यादी — नाव/आयकॉन)
const COL_PRESSACC= 'mc_press_accounts'; // प्रेस प्रतिनिधी (सार्वजनिक यादी — नाव)
const COL_ROLES   = 'mc_roles';    // Firebase Auth UID → {role, name, deptId, active} — सुरक्षा नियंत्रणासाठी

/* ===== सामान्य युजर खाती व Listings (Volunteer/Guide/Business) ===== */
const COL_USERS    = 'kc_users';    // uid → {name, email, phone, createdAt}
const COL_LISTINGS = 'kc_listings'; // ownerUid, type:'business'|'service'|'guide'|'volunteer', status:'pending'|'approved', fields...
const COL_SERVICE_REQ = 'kc_service_requests'; // uid, serviceType, name, mobile, city, date, details, status
const COL_NOTIFICATIONS = 'kc_notifications'; // uid, title, message, type, link, read:boolean, createdAt


/* =============================================================================
   R4 ADDITIONS (client helpers; none of this replaces firestore.rules)
   Unique KC_/kc prefixes on purpose: a top-level const/function that collides
   with a name already declared in an HTML page would break that page.
   ============================================================================= */
const KC_COL_COUNTERS   = 'kc_counters';

/* Marathi messages for Firebase Auth errors (registration / login / reset). */
function kcAuthMessage(code){
  switch(code){
    case 'auth/email-already-in-use':
      return 'हा ई-मेल आधीच नोंदणीकृत आहे. कृपया लॉगिन करा किंवा "पासवर्ड विसरलात?" वापरा.';
    case 'auth/invalid-email':
      return 'ई-मेल पत्ता चुकीचा आहे.';
    case 'auth/weak-password':
      return 'पासवर्ड किमान 6 अक्षरांचा असावा.';
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-credential':
      return 'ई-मेल किंवा पासवर्ड चुकीचा आहे.';
    case 'auth/too-many-requests':
      return 'खूप प्रयत्न झाले. थोड्या वेळाने पुन्हा प्रयत्न करा.';
    case 'auth/network-request-failed':
      return 'इंटरनेट कनेक्शन तपासा.';
    default:
      return 'काहीतरी चूक झाली. पुन्हा प्रयत्न करा.';
  }
}

/* Password reset e-mail. Always reports success for unknown e-mails so the
   form cannot be used to discover which e-mails are registered. Requires the
   Email/Password provider + reset template enabled in Firebase console. */
async function kcSendPasswordReset(email){
  email = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error(kcAuthMessage('auth/invalid-email'));
  }
  try { auth.languageCode = 'mr'; } catch(e) {}
  try {
    await auth.sendPasswordResetEmail(email);
  } catch (e) {
    if (e && e.code === 'auth/user-not-found') { return { ok: true }; }  // do not reveal
    throw new Error(kcAuthMessage(e && e.code));
  }
  return { ok: true };
}

/* Next registration number from kc_counters/{counterId}, matching the rules:
   create -> count == 1, update -> count == old + 1.
   prefix 'KCV' (volunteer) => KCV-2027-000001 (matches kc_volunteers regNo rule) */
async function kcNextRegNo(counterId, prefix){
  const ref = db.collection(KC_COL_COUNTERS).doc(counterId);
  const n = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = snap.exists ? (Number(snap.data().count) + 1) : 1;
    tx.set(ref, { count: next });
    return next;
  });
  return prefix + '-2027-' + String(n).padStart(6, '0');
}
