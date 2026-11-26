// Unit tests for the email guard in kc-auth.js. Run: node tests/auth-guard.test.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { Guard } = createRequire(import.meta.url)('../kc-auth.js');

const bad = {
  'user@mailinator.com': 'disposable', 'x.y@sub.yopmail.com': 'disposable', 'rahul.patil@10minutemail.com': 'disposable',
  'rahul@gmial.com': 'typo', 'rahul.patil@gmail.con': 'typo',
  'test@gmail.com': 'syntax-or-fake', 'abcdef@gmail.com': 'fake', 'aaaaaaaa@yahoo.com': 'fake', '12345@yahoo.com': 'fake',
  'asdf@outlook.com': 'fake', 'rahul@example.com': 'disposable', 'no-at-sign': 'syntax', 'a@b': 'syntax', 'a..b@x.com': 'syntax',
  'rahul@x.c': 'syntax', 'ab@gmail.com': 'fake', ' ': 'syntax', 'x@-bad.com': 'syntax'
};
for (const [e] of Object.entries(bad)) assert.equal(Guard.checkEmail(e).ok, false, 'should reject ' + e);
const good = ['rahul.patil85@gmail.com', 'sneha_k@outlook.com', 'amit+kumbh@yahoo.in', 'contact@kumbhconnect.in', 'Prakash.Joshi@RediffMail.com', 'sunita2024@proton.me'];
for (const e of good) assert.equal(Guard.checkEmail(e).ok, true, 'should accept ' + e);
assert.equal(Guard.checkEmail('rahul@gmial.com').suggestion, 'rahul@gmail.com');

console.log('auth-guard tests passed');
