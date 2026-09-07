const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function createMinisignTestKeyPair(directory) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const publicRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const secretSeed = privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32);
  const keyId = crypto.randomBytes(8);
  const secretRaw = Buffer.concat([secretSeed, publicRaw]);
  const checksum = crypto.createHash('blake2b512').update(Buffer.concat([Buffer.from('Ed'), keyId, secretRaw])).digest().subarray(0, 32);
  const publicPath = path.join(directory, 'minisign.pub');
  const privatePath = path.join(directory, 'minisign.key');
  fs.writeFileSync(publicPath, `untrusted comment: minisign public key ${keyId.toString('hex').toUpperCase()}\n${Buffer.concat([Buffer.from('Ed'), keyId, publicRaw]).toString('base64')}\n`);
  fs.writeFileSync(privatePath, `untrusted comment: minisign secret key\n${Buffer.concat([Buffer.from('Ed'), Buffer.from([0, 0]), Buffer.from('B2'), Buffer.alloc(32), Buffer.alloc(8), Buffer.alloc(8), keyId, secretRaw, checksum]).toString('base64')}\n`);
  return { publicPath, privatePath };
}

function signMinisignData(data, fileName, privatePath, signaturePath) {
  const encoded = fs.readFileSync(privatePath, 'utf8').trim().split(/\r?\n/)[1];
  const secret = Buffer.from(encoded, 'base64');
  const keyId = secret.subarray(54, 62);
  const seed = secret.subarray(62, 94);
  const key = crypto.createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const hashed = crypto.createHash('blake2b512').update(data).digest();
  const primarySignature = crypto.sign(null, hashed, key);
  const primary = Buffer.concat([Buffer.from('ED'), keyId, primarySignature]);
  const trustedComment = `timestamp:1\tfile:${path.basename(fileName)}\thashed`;
  const globalSignature = crypto.sign(null, Buffer.concat([primarySignature, Buffer.from(trustedComment)]), key);
  fs.writeFileSync(signaturePath, `untrusted comment: signature from minisign secret key\n${primary.toString('base64')}\ntrusted comment: ${trustedComment}\n${globalSignature.toString('base64')}\n`);
}

function signMinisignFile(filePath, privatePath, signaturePath) {
  signMinisignData(fs.readFileSync(filePath), filePath, privatePath, signaturePath);
}

module.exports = { createMinisignTestKeyPair, signMinisignData, signMinisignFile };
