

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

/* ===== सामान्य युजर खाती व Listings (Volunteer/Guide/Business) ===== */
const COL_USERS    = 'kc_users';    // uid → {name, email, phone, createdAt}
const COL_LISTINGS = 'kc_listings'; // ownerUid, type:'business'|'service'|'guide'|'volunteer', status:'pending'|'approved', fields...
const COL_SERVICE_REQ = 'kc_service_requests'; // uid, serviceType, name, mobile, city, date, details, status
