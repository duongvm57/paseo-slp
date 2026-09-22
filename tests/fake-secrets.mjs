// Secret-shaped fixtures are assembled at runtime so the source tree never
// contains a detector-matching literal (secret scanners flag real-shaped
// strings regardless of intent). The built values still satisfy the
// redaction patterns, which is what the tests exercise.
export const fakeOrKey = suffix => ['sk', 'or', 'v1', suffix].join('-');
export const fakeTsKey = suffix => ['ts', suffix].join('-');
export const fakeAwsKey = () => ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
export const fakePem = kind => ['-----BEGIN', kind, 'PRIVATE', 'KEY-----'].join(' ');
