/**
functions to support El-Gamal encryption over a BabyJubJub curve
*/

import config from './config';
import { modDivide } from './modular-division';
import utils from './zkpUtils';

// const utils = require('zkp-utils')('/app/config/stats.json');

const { BABYJUBJUB, ZOKRATES_PRIME, TEST_PRIVATE_KEYS } = config;
const one = BigInt(1);
const { JUBJUBE, JUBJUBC, GENERATOR } = BABYJUBJUB;
const Fp = BigInt(ZOKRATES_PRIME); // the prime field used with the curve E(Fp)
const Fq = JUBJUBE / JUBJUBC;
const AUTHORITY_PRIVATE_KEYS = [];
const AUTHORITY_PUBLIC_KEYS = [];

function isOnCurve(p) {
  const { JUBJUBA: a, JUBJUBD: d } = BABYJUBJUB;
  const uu = (p[0] * p[0]) % Fp;
  const vv = (p[1] * p[1]) % Fp;
  const uuvv = (uu * vv) % Fp;
  return (a * uu + vv) % Fp === (one + d * uuvv) % Fp;
}

function negate(g) {
  return [Fp - g[0], g[1]]; // this is wierd - we negate the x coordinate, not the y with babyjubjub!
}

/**
Point addition on the babyjubjub curve TODO - MOD P THIS
*/
export function add(p, q) {
  const { JUBJUBA: a, JUBJUBD: d } = BABYJUBJUB;
  const u1 = p[0];
  const v1 = p[1];
  const u2 = q[0];
  const v2 = q[1];
  const uOut = modDivide(u1 * v2 + v1 * u2, one + d * u1 * u2 * v1 * v2, Fp);
  const vOut = modDivide(v1 * v2 - a * u1 * u2, one - d * u1 * u2 * v1 * v2, Fp);
  if (!isOnCurve([uOut, vOut])) throw new Error('Addition point is not on the babyjubjub curve');
  return [uOut, vOut];
}

/**
Scalar multiplication on a babyjubjub curve
@param {String} scalar - scalar mod q (will wrap if greater than mod q, which is probably ok)
@param {Object} h - curve point in u,v coordinates
*/
export function scalarMult(scalar, h) {
  const { INFINITY } = BABYJUBJUB;
  const a = ((BigInt(scalar) % Fq) + Fq) % Fq; // just in case we get a value that's too big or negative
  const exponent = a.toString(2).split(''); // extract individual binary elements
  let doubledP = [...h]; // shallow copy h to prevent h being mutated by the algorithm
  let accumulatedP = INFINITY;
  for (let i = exponent.length - 1; i >= 0; i--) {
    const candidateP = add(accumulatedP, doubledP);
    accumulatedP = exponent[i] === '1' ? candidateP : accumulatedP;
    doubledP = add(doubledP, doubledP);
  }
  if (!isOnCurve(accumulatedP))
    throw new Error('Scalar multiplication point is not on the babyjubjub curve');
  return accumulatedP;
}

// function to set the public keys used by the authority for decryption
function setAuthorityPublicKeys() {
  for (let i = 0; i < AUTHORITY_PRIVATE_KEYS.length; i++) {
    if (AUTHORITY_PRIVATE_KEYS[i] === undefined)
      throw new Error('Cannot create public key, private key not set');
    AUTHORITY_PUBLIC_KEYS[i] = scalarMult(AUTHORITY_PRIVATE_KEYS[i], GENERATOR);
  }
}

/** function to set the private keys used by the authority for decryption
@param {Array(String)} keys - array of hex private key strings
*/
export function setAuthorityPrivateKeys(keys = TEST_PRIVATE_KEYS) {
  if (keys[0] === TEST_PRIVATE_KEYS[0])
    console.log('DANGER, WILL ROBINSON! INSECURE TEST-KEYS ARE BEING USED!');
  for (let i = 0; i < keys.length; i++) {
    AUTHORITY_PRIVATE_KEYS.push(utils.ensure0x(keys[i]));
  }
  setAuthorityPublicKeys();
}

/**
Performs El-Gamal encryption
@param {Array(String)} strings - array containing the hex strings to be encrypted
@param {String} randomSecret - random value mod Fq.  Must be changed each time
this function is called
*/
export function enc(randomSecret, ...strings) {
  if (AUTHORITY_PUBLIC_KEYS.length !== strings.length)
    throw new Error(
      'The number of authority public keys and the number of messages must be the same',
    );
  // We can't directly encrypt hex strings.  We can encrypt a curve point however,
  // so we convert a string to a curve point by a scalar multiplication
  const messages = strings.map(e => scalarMult(utils.ensure0x(e), GENERATOR));
  // now we use the public keys and random number to generate shared secrets
  const sharedSecrets = AUTHORITY_PUBLIC_KEYS.map(e => {
    if (e === undefined) throw new Error('Trying to encrypt with a undefined public key');
    return scalarMult(utils.ensure0x(randomSecret), e);
  });
  // finally, we can encrypt the messages using the share secrets
  const c0 = scalarMult(randomSecret, GENERATOR);
  const encryptedMessages = messages.map((e, i) => add(e, sharedSecrets[i]));
  const encryption = [...c0, ...encryptedMessages];
  return encryption;
}

/**
Decrypt the above
*/
export function dec(encryption) {
  const c0 = encryption[0];
  const encryptedMessages = encryption.slice(1);
  // recover the shared secrets
  const sharedSecrets = AUTHORITY_PRIVATE_KEYS.map(e => {
    if (e === undefined) throw new Error('Trying to decrypt with a undefined private key');
    return scalarMult(e, c0);
  });
  // then decrypt
  const messages = encryptedMessages.map((c, i) => add(c + negate(sharedSecrets[i])));
  return messages;
}
