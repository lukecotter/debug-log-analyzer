import { tryCatch, tryCatchAsync } from '../src/tryCatch.js';

describe('tryCatch', () => {
  it('returns result and null error for successful sync function', () => {
    const [result, error] = tryCatch(() => 42);
    expect(result).toBe(42);
    expect(error).toBeNull();
  });

  it('returns null result and error for throwing sync function', () => {
    const testError = new Error('fail');
    const [result, error] = tryCatch(() => {
      throw testError;
    });
    expect(result).toBeNull();
    expect(error).toBe(testError);
  });
});

describe('tryCatchAsync', () => {
  it('returns result and null error for a resolved promise', async () => {
    const [result, error] = await tryCatchAsync(Promise.resolve('hello'));
    expect(result).toBe('hello');
    expect(error).toBeNull();
  });

  it('returns null result and error for a rejected promise', async () => {
    const testError = new Error('async fail');
    const [result, error] = await tryCatchAsync(Promise.reject(testError));
    expect(result).toBeNull();
    expect(error).toBe(testError);
  });

  it('resolves the value of an async function call', async () => {
    const load = async () => 123;
    const [result, error] = await tryCatchAsync(load());
    expect(result).toBe(123);
    expect(error).toBeNull();
  });

  it('accepts a function that returns a promise', async () => {
    const [result, error] = await tryCatchAsync(async () => 'fn');
    expect(result).toBe('fn');
    expect(error).toBeNull();
  });

  it('catches a synchronous throw while creating the promise', async () => {
    const testError = new Error('sync throw');
    const [result, error] = await tryCatchAsync(() => {
      throw testError;
    });
    expect(result).toBeNull();
    expect(error).toBe(testError);
  });
});
