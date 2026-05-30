/**
 * Ant Design's `form.validateFields()` rejects with an object carrying an
 * `errorFields` array (not an `Error`). Use this guard to distinguish a
 * validation rejection from a real error before surfacing a toast.
 */
export function isAntdFormError(error: unknown): error is { errorFields: unknown[] } {
  return typeof error === "object" && error !== null && "errorFields" in error;
}
