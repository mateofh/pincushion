// Errores de dominio compartidos. Los mensajes se muestran tal cual en la interfaz (español).

export class ValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export class NotFoundError extends Error {
  constructor(message = 'No encontrado') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export function isValidationError(e: unknown): e is ValidationError {
  return e instanceof ValidationError;
}

/** `{ campo: mensaje }` para pintar el error junto al campo; null si no es un error de validación. */
export function toFieldErrors(e: unknown): Record<string, string> | null {
  return e instanceof ValidationError ? { [e.field]: e.message } : null;
}
