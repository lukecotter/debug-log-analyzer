/**
 * Executes a synchronous function and returns a tuple containing either the result or the error.
 *
 * @typeParam T - The type of the result returned by the function.
 * @typeParam E - The type of the error (defaults to Error).
 * @param fn - The synchronous function to execute.
 * @returns A tuple where the first element is the result (or null if an error occurred),
 * and the second element is the error (or null if no error occurred).
 *
 * @example
 * const [result, error] = tryCatch(() => JSON.parse('{"valid": true}'));
 * if (error) {
 *   // handle error
 * } else {
 *   // use result
 * }
 */
export function tryCatch<T, E = Error>(fn: () => T): [T | null, E | null] {
  try {
    const result = fn();
    return [result, null];
  } catch (error) {
    return [null, error as E];
  }
}

/**
 * Awaits a promise (or a function that returns one) and returns a tuple containing
 * either the resolved value or the error.
 *
 * @typeParam T - The type of the value the promise resolves to.
 * @typeParam E - The type of the error (defaults to Error).
 * @param promiseOrFn - A promise to await, or a function that returns the promise to await.
 * Passing a function also catches synchronous throws that happen while creating the promise.
 * @returns A promise that resolves to a tuple where the first element is the result (or null if an error occurred),
 * and the second element is the error (or null if no error occurred).
 *
 * @example
 * const [result, error] = await tryCatchAsync(fetchData());
 * const [result, error] = await tryCatchAsync(() => fetchData());
 * if (error) {
 *   // handle error
 * } else {
 *   // use result
 * }
 */
export async function tryCatchAsync<T, E = Error>(
  promiseOrFn: Promise<T> | (() => Promise<T>),
): Promise<[T | null, E | null]> {
  try {
    const result = await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
    return [result, null];
  } catch (error) {
    return [null, error as E];
  }
}
