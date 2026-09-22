// Secret-shaped fixtures are assembled at runtime so the source tree never
// contains a detector-matching literal (secret scanners flag real-shaped
// strings regardless of intent). The built values still satisfy the
// redaction patterns, which is what the tests exercise.
export const fakeOrKey = suffix => ['sk', 'or', 'v1', suffix].join('-');
export const fakeTsKey = suffix => ['ts', suffix].join('-');
export const fakeAwsKey = () => ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
export const fakePem = kind => ['-----BEGIN', kind, 'PRIVATE', 'KEY-----'].join(' ');
export const fakeOpenAiKey = suffix => ['sk', suffix].join('-');
export const fakeBearer = token => ['Bearer', token].join(' ');
export const fakeGhToken = suffix => ['ghp', suffix].join('_');
export const fakeSlackToken = suffix => ['xoxb', suffix].join('-');
export const fakeGoogleKey = suffix => ['AIza', suffix].join('');
export const fakeJwt = () => ['eyJ' + 'a'.repeat(12), 'b'.repeat(12), 'c'.repeat(6)].join('.');
