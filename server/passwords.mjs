import { scrypt as derive, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(derive);
// Parents and viewers need 12 characters; kid logins may use 8 because a parent reviews what they post.
export async function passwordRecord(password, { min = 12 } = {}) {
  if (typeof password !== 'string' || password.length < min || password.length > 128) throw new Error(`Use a password of ${min}–128 characters.`);
  const salt = randomBytes(16).toString('hex');
  const hash = 'scrypt:' + (await scrypt(password, salt, 64)).toString('hex');
  return { salt, hash };
}
export async function passwordMatches(password, row) {
  if (!row || typeof password !== 'string' || password.length > 128 || !/^scrypt:[a-f0-9]{128}$/.test(row.hash)) return false;
  const actual = await scrypt(password, row.salt, 64);
  return timingSafeEqual(actual, Buffer.from(row.hash.slice(7), 'hex'));
}
