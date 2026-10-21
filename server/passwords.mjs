import { scrypt as derive, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(derive);
export async function passwordRecord(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('Use a password of 12–128 characters.');
  const salt = randomBytes(16).toString('hex');
  const hash = 'scrypt:' + (await scrypt(password, salt, 64)).toString('hex');
  return { salt, hash };
}
export async function passwordMatches(password, row) {
  if (!row || typeof password !== 'string' || password.length > 128 || !/^scrypt:[a-f0-9]{128}$/.test(row.hash)) return false;
  const actual = await scrypt(password, row.salt, 64);
  return timingSafeEqual(actual, Buffer.from(row.hash.slice(7), 'hex'));
}
