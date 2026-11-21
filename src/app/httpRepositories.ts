import type { ApiConfig } from '../api/config.ts'
import { createHttpClient } from '../api/http.ts'
import { createHttpAccessRepository } from '../features/access/httpRepository.ts'
import type { AppRepositories } from './repositories.ts'

// Http mode: the real API. It always opens at code entry, as the session
// cookie cannot be read here and a reload does not restore the session yet.
export function createHttpRepositories({
  baseUrl,
  credentials,
}: Pick<ApiConfig, 'baseUrl' | 'credentials'>): AppRepositories {
  const client = createHttpClient({ baseUrl, credentials })
  return {
    access: createHttpAccessRepository({ client }),
    entryNotice: null,
    entrySearch: '',
    preview: null,
  }
}
