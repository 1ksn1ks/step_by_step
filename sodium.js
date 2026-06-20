// crypto.js
import _sodium from 'libsodium-wrappers-sumo';   // ← Must be -sumo

await _sodium.ready;
const sodium = _sodium;

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

export function parsePublicKey(derHex) {
  const derBytes = hexToBytes(derHex);
  return derBytes.slice(derBytes.length - 32);
}

export function parsePrivateKey(derHex) {
  const derBytes = hexToBytes(derHex);
  const seed = derBytes.slice(derBytes.length - 32);
  const keyPair = sodium.crypto_sign_seed_keypair(seed);
  return keyPair.privateKey;
}

export async function encryptMessage(message, recipientPublicKey) {
  await sodium.ready;
  const recipientX25519Public = sodium.crypto_sign_ed25519_pk_to_curve25519(recipientPublicKey);
  const ciphertext = sodium.crypto_box_seal(message, recipientX25519Public);
  return { ciphertext: sodium.to_base64(ciphertext) };
}

export async function decryptMessage(encryptedData, recipientPrivateKey) {
  await sodium.ready;
  const recipientPublicKey = recipientPrivateKey.slice(32);
  const recipientX25519Private = sodium.crypto_sign_ed25519_sk_to_curve25519(recipientPrivateKey);
  const recipientX25519Public = sodium.crypto_sign_ed25519_pk_to_curve25519(recipientPublicKey);

  const ciphertext = sodium.from_base64(encryptedData.ciphertext);
  const decrypted = sodium.crypto_box_seal_open(ciphertext, recipientX25519Public, recipientX25519Private);
  return sodium.to_string(decrypted);
}

/* ==================== PASSWORD ENCRYPTION ==================== */

export async function encryptWithPassword(data, password) {
  await sodium.ready;

  if (!data || typeof data !== 'string' || data.length === 0) {
    throw new Error("Private key cannot be empty");
  }
  if (!password || typeof password !== 'string' || password.length < 5) {
    throw new Error("Password must be at least 5 characters long");
  }

  const dataBytes = sodium.from_string(data);
  const passwordBytes = sodium.from_string(password);

  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);

  const key = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    passwordBytes,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );

  const encryptedBytes = sodium.crypto_secretbox_easy(dataBytes, nonce, key);

  return {
    encrypted: sodium.to_base64(encryptedBytes),
    nonce: sodium.to_base64(nonce),
    salt: sodium.to_base64(salt)
  };
}

export async function decryptWithPassword(encrypted, nonce, salt, password) {
  
  const variant = sodium.base64_variants.URLSAFE_NO_PADDING;

  const encryptedBytes = sodium.from_base64(encrypted, variant);
  const nonceBytes = sodium.from_base64(nonce, variant);
  const saltBytes = sodium.from_base64(salt, variant);
  const passwordBytes = sodium.from_string(password);

  const key = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    passwordBytes,
    saltBytes,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );

  try {
    const decryptedBytes = sodium.crypto_secretbox_open_easy(encryptedBytes, nonceBytes, key);
    return sodium.to_string(decryptedBytes);
  } catch (error) {
    throw new Error("Decryption failed: Incorrect password.");
  }
}