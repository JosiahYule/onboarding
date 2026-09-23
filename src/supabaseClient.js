import { createClient } from '@supabase/supabase-js'

const env = import.meta.env || {}
const supabaseUrl = env.REACT_APP_SUPABASE_URL || 'https://gqgjnltqbomtefryqlua.supabase.co'
const supabaseAnonKey = env.REACT_APP_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxZ2pubHRxYm9tdGVmcnlxbHVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNDQwNDAsImV4cCI6MjA5MTkyMDA0MH0.FS8xUisIdPRKHLlKWHLR2H3Vt4iOLGkMVuJAzUvIvVw'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Resolves to the profile, or null when the user has no profile row. Throws on
// a real failure (network, permissions) so the caller can offer a retry
// instead of treating a blip as "account not set up".
export async function getUserProfile(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}