export async function saveBeforeAction(save, action) {
  if (!await save()) return false;
  await action?.();
  return true;
}
