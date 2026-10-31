/**
 * The Firebase JS SDK functions the admin uses (`firebase` 13.0.0, the engine's pin), in one table the adapters take, so
 * their node tests pass a fake table instead. Analytics is not here: it is its own lazily imported module
 * (`analytics-sdk.ts`), loaded only after consent. Only this folder and the entry import the SDK
 * (`docs/research/M2b-interfaces.md` §1.7).
 */
import { initializeApp } from 'firebase/app';
import { ReCaptchaEnterpriseProvider, initializeAppCheck } from 'firebase/app-check';
import {
    GoogleAuthProvider,
    browserPopupRedirectResolver,
    browserSessionPersistence,
    connectAuthEmulator,
    initializeAuth,
    onAuthStateChanged,
    reauthenticateWithCredential,
    reauthenticateWithPopup,
    signInWithCredential,
    signInWithPopup,
    signOut,
} from 'firebase/auth';
import {
    collection,
    connectFirestoreEmulator,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    getFirestore,
    onSnapshot,
    query,
    serverTimestamp,
    setDoc,
    where,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { connectStorageEmulator, getStorage, ref, uploadBytes } from 'firebase/storage';

export const firebaseSdk = {
    initializeApp,
    initializeAppCheck,
    ReCaptchaEnterpriseProvider,
    initializeAuth,
    browserSessionPersistence,
    browserPopupRedirectResolver,
    connectAuthEmulator,
    onAuthStateChanged,
    signOut,
    signInWithPopup,
    reauthenticateWithPopup,
    signInWithCredential,
    reauthenticateWithCredential,
    GoogleAuthProvider,
    getFunctions,
    connectFunctionsEmulator,
    httpsCallable,
    getFirestore,
    connectFirestoreEmulator,
    doc,
    getDoc,
    setDoc,
    deleteDoc,
    onSnapshot,
    collection,
    query,
    where,
    getDocs,
    serverTimestamp,
    getStorage,
    connectStorageEmulator,
    ref,
    uploadBytes,
};

export type FirebaseSdk = typeof firebaseSdk;
