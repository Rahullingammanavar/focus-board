// Firebase sign-in + Firestore sync. Loaded only when the app is not in ?local mode.
// Each user has one document: users/{uid} = { savedAt: number, state: string(JSON) }.
import { FIREBASE_CONFIG, FIREBASE_SDK_URL } from './config.js';

/**
 * @param {object} h handlers
 * @param {(user:{uid:string,name:string,email:string}, store:{set:(d:object)=>Promise<void>}) => void} h.onSignedIn
 * @param {() => void} h.onSignedOut
 * @param {(snap:{exists:boolean,data:()=>any,metadata:any}) => void} h.onSnapshot
 * @param {(err:any) => void} h.onError
 * @returns {Promise<{signIn:()=>Promise<void>, signOut:()=>Promise<void>}>}
 */
export async function startFirebase(h) {
  const [appMod, authMod, fsMod] = await Promise.all([
    import(FIREBASE_SDK_URL + 'firebase-app.js'),
    import(FIREBASE_SDK_URL + 'firebase-auth.js'),
    import(FIREBASE_SDK_URL + 'firebase-firestore.js')
  ]);
  const fb = Object.assign({}, appMod, authMod, fsMod);
  const app = fb.initializeApp(FIREBASE_CONFIG);
  const auth = fb.getAuth(app);

  let db;
  try {
    // Keeps a copy in IndexedDB so the app opens fast and works offline.
    db = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) });
  } catch (e) {
    db = fb.getFirestore(app);
  }

  let unsub = null;
  fb.onAuthStateChanged(auth, user => {
    if (unsub) { unsub(); unsub = null; }
    if (!user) { h.onSignedOut(); return; }
    const ref = fb.doc(db, 'users', user.uid);
    h.onSignedIn(
      { uid: user.uid, name: user.displayName || '', email: user.email || '' },
      { set: d => fb.setDoc(ref, d) }
    );
    unsub = fb.onSnapshot(ref,
      snap => h.onSnapshot({ exists: snap.exists(), data: () => snap.data(), metadata: snap.metadata }),
      err => h.onError(err));
  });

  return {
    async signIn() {
      const provider = new fb.GoogleAuthProvider();
      try {
        await fb.signInWithPopup(auth, provider);
      } catch (e) {
        const fallback = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'];
        if (fallback.includes(e.code)) await fb.signInWithRedirect(auth, provider);
        else if (e.code !== 'auth/popup-closed-by-user') throw e;
      }
    },
    signOut: () => fb.signOut(auth)
  };
}
