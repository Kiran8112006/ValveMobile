// src/auth/tokens.ts
import { getAuth } from "firebase-admin/auth";
var FirebaseTokenVerifier = class {
  async verify(idToken) {
    const decoded = await getAuth().verifyIdToken(idToken, true);
    return {
      uid: decoded.uid,
      email: typeof decoded.email === "string" ? decoded.email : null,
      admin: decoded.admin === true || decoded.role === "admin",
      emailVerified: decoded.email_verified === true
    };
  }
};
export {
  FirebaseTokenVerifier
};
//# sourceMappingURL=tokens-AOEH7JTM.js.map