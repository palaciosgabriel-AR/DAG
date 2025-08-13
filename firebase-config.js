<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyBukCK_qvHrHqkUYR90ch25vV_tsbe2RBo",
    authDomain: "daeg-d59cf.firebaseapp.com",
    projectId: "daeg-d59cf",
    storageBucket: "daeg-d59cf.firebasestorage.app",
    messagingSenderId: "862000912172",
    appId: "1:862000912172:web:27e96ecff42a6806897e89",
    measurementId: "G-Y0LLM4HYLP"
  };

// Everyone who should sync shares this id (Firestore doc: games/DAEG)
export const GAME_ID = "DAEG";
