// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  addDoc,
  onSnapshot,
  serverTimestamp,
  deleteDoc,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyArtEX7-LBDE5LLQajIwdMJuoDFJSd5eKw",
  authDomain: "practicebase-8762h8b2.firebaseapp.com",
  projectId: "practicebase-8762h8b2",
  storageBucket: "practicebase-8762h8b2.firebasestorage.app",
  messagingSenderId: "214656580811",
  appId: "1:214656580811:web:ca51a9550c035215c9ef4e",
  measurementId: "G-LGBLYT0FZS"
};


const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export {
  auth,
  db,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  collection,
  doc,
  setDoc,
  getDoc,
  addDoc,
  onSnapshot,
  serverTimestamp,
  deleteDoc,
  query,
  orderBy
};
