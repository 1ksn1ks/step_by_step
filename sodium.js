// crypto.js
import _sodium from 'libsodium-wrappers';  // or 'libsodium-wrappers-sumo'

await _sodium.ready;
const sodium = _sodium;  // now use 'sodium' exactly like before

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

  return {
    ciphertext: sodium.to_base64(ciphertext)
  };
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
