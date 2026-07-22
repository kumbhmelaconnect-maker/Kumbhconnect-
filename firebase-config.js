/* =====================================================================
   KumbhConnect Media Center — Firebase + Cloudinary कॉन्फिग (शेअर्ड फाईल)
   media-center.html आणि media-center-admin.html दोन्ही ही फाईल वापरतात,
   त्यामुळे config एकाच ठिकाणी बदलला की दोन्ही फाईल्समध्ये लागू होतो.

   ═══════════════════════════════════════════════════════════════════
   STEP 1 — नवीन Firebase प्रोजेक्ट बनवा (५ मिनिटं, मोफत)
   ═══════════════════════════════════════════════════════════════════
   1. https://console.firebase.google.com इथे जा, Google खात्याने Login करा.
   2. "Add project" क्लिक करा → नाव द्या (उदा. kumbhconnect-media) → Continue.
   3. Google Analytics विचारेल — "Enable" बंद करून Continue केलं तरी चालेल.
   4. प्रोजेक्ट तयार झाल्यावर डाव्या मेनूत "Build" → "Firestore Database" उघडा
      → "Create database" → Location जवळचं निवडा (उदा. asia-south1 Mumbai)
      → "Start in test mode" निवडा (सध्या टेस्टिंगसाठी; नंतर rules कडक करू).
   5. डाव्या मेनूत ⚙️ (Project settings) → खाली स्क्रोल करून "Your apps" →
      "</>" (Web) आयकॉन क्लिक करा → App नाव द्या (उदा. media-center-web)
      → "Register app" → खाली दिसणारा firebaseConfig ऑब्जेक्ट कॉपी करा.
   6. तो ऑब्जेक्ट खाली FIREBASE_CONFIG मध्ये paste करा (जिथे "PASTE_..." लिहिलंय
      तिथे प्रत्येक व्हॅल्यू बदला).

   ═══════════════════════════════════════════════════════════════════
   STEP 2 — Cloudinary वर unsigned upload preset बनवा (फोटो साठवण्यासाठी)
   ═══════════════════════════════════════════════════════════════════
   Firestore मध्ये फक्त मजकूर (text) साठवला जातो — मोठे फोटो साठवण्यासाठी
   Cloudinary वापरतो (मोफत प्लॅन: 25 GB स्टोरेज पुरेसा आहे).
   1. https://cloudinary.com/users/register/free इथे मोफत खातं बनवा.
   2. Login केल्यावर Dashboard वर सर्वात वर "Cloud name" दिसेल — तो कॉपी करा.
   3. डाव्या मेनूत Settings (⚙️) → "Upload" टॅब उघडा.
   4. खाली "Upload presets" सेक्शनमध्ये "Add upload preset" क्लिक करा.
   5. "Signing Mode" → "Unsigned" निवडा (महत्त्वाचं — याशिवाय ब्राउझरमधून
      थेट अपलोड होणार नाही). Folder name द्यायचं असल्यास द्या (उदा. kumbh-media).
      Save करा — वर दिसणारं preset name कॉपी करा.
   6. खाली CLOUDINARY_CONFIG मध्ये cloudName आणि uploadPreset पेस्ट करा.

   हे दोन्ही एकदाच करायचं काम आहे — नंतर दोन्ही HTML फाईल्स आपोआप हेच
   वापरतील. मूल्यं बदलल्यावर फाईल सेव्ह करा आणि दोन्ही पेजेस रिलोड करा.
===================================================================== */

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

/* ===== Firebase init (compat SDK — index.html मध्ये स्क्रिप्ट टॅगने आधीच लोड केलेली असते) ===== */
firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();
const auth = firebase.auth();

/* ===== Cloudinary अपलोड हेल्पर — File ऑब्जेक्ट घेऊन secure_url परत देतो ===== */
async function uploadToCloudinary(file){
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
  const res = await fetch(url, { method:'POST', body:fd });
  if(!res.ok){ throw new Error('Cloudinary upload failed: ' + res.status); }
  const data = await res.json();
  return data.secure_url;
}

/* ===== कॉमन Firestore कलेक्शन नावं — दोन्ही फाईल्समध्ये सेम ठेवा ===== */
const COL_PHOTOS  = 'mc_photos';   // सर्व फोटो: previous / live / govt / guide / user — status: pending/approved
const COL_PRESS   = 'mc_press';    // प्रेस रिलीज
const COL_DEPTS   = 'mc_departments';    // विभाग (सार्वजनिक यादी — नाव/आयकॉन)
const COL_PRESSACC= 'mc_press_accounts'; // प्रेस प्रतिनिधी (सार्वजनिक यादी — नाव)
const COL_ROLES   = 'mc_roles';    // Firebase Auth UID → {role, name, deptId, active} — सुरक्षा नियंत्रणासाठी
