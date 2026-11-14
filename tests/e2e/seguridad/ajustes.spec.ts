// Ajustes: zona horaria, cambio de contraseña y cerrar sesión en todos los dispositivos.
import { test, expect, login, e2eDb, PASSWORD } from '../fixtures/test.ts';

test('cambiar la zona horaria persiste tras recargar @sin-js', async ({ signedIn: page, owner }) => {
  await page.getByRole('link', { name: 'Ajustes' }).click();
  await expect(page.getByRole('heading', { name: 'Ajustes', level: 1 })).toBeVisible();
  await expect(page.getByText('Diseñado con el sistema de Mateo Folador')).toBeVisible();
  await page.getByLabel('Zona horaria').selectOption('America/Bogota');
  await page.getByRole('button', { name: 'Guardar zona horaria' }).click();
  await expect(page).toHaveURL('/ajustes');
  await expect(page.getByRole('status')).toContainText('Zona horaria guardada.');
  await page.reload();
  await expect(page.getByLabel('Zona horaria')).toHaveValue('America/Bogota');
  expect(e2eDb().get<{ timezone: string }>('SELECT timezone FROM users WHERE id = ?', owner.id)!.timezone).toBe('America/Bogota');
});

test('una zona horaria inventada se rechaza junto al campo', async ({ signedIn: page }) => {
  await page.goto('/ajustes');
  await page.getByLabel('Zona horaria').evaluate((el) => {
    const opt = document.createElement('option');
    opt.value = 'Mars/Olympus';
    opt.textContent = 'Marte';
    el.appendChild(opt);
    (el as HTMLSelectElement).value = 'Mars/Olympus';
  });
  await page.getByRole('button', { name: 'Guardar zona horaria' }).click();
  await expect(page.getByText('Elige una zona horaria de la lista.')).toBeVisible();
});

test('cerrar sesión en todos los dispositivos invalida otro contexto', async ({ signedIn: page, owner, browser }) => {
  const other = await browser.newContext();
  const phone = await other.newPage();
  await login(phone, owner);
  await expect(phone).toHaveURL('/');

  await page.goto('/ajustes');
  await page.getByRole('button', { name: 'Cerrar sesión en todos los dispositivos' }).click();
  await expect(page).toHaveURL('/entrar');
  await expect(page.getByRole('status')).toContainText('Cerraste sesión en todos los dispositivos.');

  await phone.goto('/');
  await expect(phone).toHaveURL(/\/entrar\?next=%2F&expirada=1/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/entrar/);
  await other.close();
});

test('cambiar la contraseña cierra las demás sesiones y mantiene esta', async ({ signedIn: page, owner, browser }) => {
  const other = await browser.newContext();
  const phone = await other.newPage();
  await login(phone, owner);

  await page.goto('/ajustes');
  await page.getByLabel('Contraseña actual').fill('incorrecta-del-todo');
  await page.getByLabel('Contraseña nueva', { exact: true }).fill('una-contraseña-nueva');
  await page.getByLabel('Repite la contraseña nueva').fill('una-contraseña-nueva');
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await expect(page.getByText('La contraseña actual no es correcta.')).toBeVisible();

  await page.getByLabel('Contraseña actual').fill(PASSWORD);
  await page.getByLabel('Contraseña nueva', { exact: true }).fill('una-contraseña-nueva');
  await page.getByLabel('Repite la contraseña nueva').fill('una-contraseña-nueva');
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await expect(page.getByRole('status')).toContainText('Contraseña cambiada. Cerramos tu otra sesión abierta.');

  await page.goto('/');
  await expect(page).toHaveURL('/');
  await phone.goto('/');
  await expect(phone).toHaveURL(/\/entrar/);
  await login(phone, { ...owner, password: 'una-contraseña-nueva' });
  await expect(phone).toHaveURL('/');
  await other.close();
});
