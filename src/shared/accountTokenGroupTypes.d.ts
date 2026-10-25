export interface AccountTokenGroup {
  /** The upstream value used when creating or updating a token. */
  name: string;
  label?: string;
  ratio?: number | 'auto';
  description?: string;
}
