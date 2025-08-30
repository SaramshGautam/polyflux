// const firebaseConfig = {
//   apiKey: "AIzaSyCs-xerrIr0KpnCTihTX-GowGDAZbRZFvA",
//   authDomain: "creative-assistant-j.firebaseapp.com",
//   databaseURL: "https://creative-assistant-j-default-rtdb.firebaseio.com",
//   projectId: "creative-assistant-j",
//   storageBucket: "creative-assistant-j.firebasestorage.app",
//   messagingSenderId: "414003942125",
//   appId: "1:414003942125:web:d1400f5fa9358683f832e4",
//   measurementId: "G-NJWKCE24C4",
// };

// export default firebaseConfig;

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCs-xerrIr0KpnCTihTX-GowGDAZbRZFvA",
  authDomain: "creative-assistant-j.firebaseapp.com",
  databaseURL: "https://creative-assistant-j-default-rtdb.firebaseio.com",
  projectId: "creative-assistant-j",
  // storageBucket: "creative-assistant-j.appspot.com",
  // storageBucket: "polyflux_cloudbuild",
  storageBucket: "creative-assistant-j.firebasestorage.app",
  messagingSenderId: "414003942125",
  appId: "1:414003942125:web:d1400f5fa9358683f832e4",
  measurementId: "G-NJWKCE24C4",
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firestore (Database)
const db = getFirestore(app);

// Initialize Firebase Authentication
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider(); // For Google Sign-In

// Initialize Firebase Storage
const storage = getStorage(app);

// Export for use in other parts of the app
export { app, db, auth, googleProvider, storage };
