import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { handleSupabaseError } from '../utils/handleError'
import { getToday } from '../config'
import { computeProgressFromRaw } from '../utils/taskProgress'

export function calcProgress(taskCompletions) {
  return computeProgressFromRaw(taskCompletions)
}

export function useDashboard(refreshKey) {
  const [onboardings, setOnboardings] = useState([])
  const [completedCount, setCompletedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(null)
  const [docStats, setDocStats] = useState({})
  const [offToday, setOffToday] = useState([])

  useEffect(() => {
    fetchOnboardings()
    fetchCompleted()
    fetchOffToday()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch only when refreshKey changes
  }, [refreshKey])

  async function fetchOnboardings() {
    setLoading(true)
    setFetchError(null)
    const { data, error } = await supabase
      .from('onboarding_instances')
      .select(`
        id, started_at, status,
        employees (id, full_name, email, hire_date, roles (name)),
        task_completions (id, completed, onboarding_templates (id, parent_id))
      `)
      .eq('status', 'active')
      .order('started_at', { ascending: false })

    if (error) {
      setFetchError(handleSupabaseError(error, 'Failed to load onboardings.'))
    } else {
      // A row whose employee isn't readable (row-level security, or a deleted
      // record) would crash every o.employees.* access below; skip it.
      const rows = (data || []).filter(o => o.employees)
      setOnboardings(rows)
      fetchDocStats(rows)
    }
    setLoading(false)
  }

  async function fetchCompleted() {
    const { count, error } = await supabase
      .from('onboarding_instances')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed')
    if (!error) setCompletedCount(count || 0)
  }

  async function fetchOffToday() {
    const today = getToday()
    const { data } = await supabase
      .from('time_off_requests')
      .select('employee_id, employees!time_off_requests_employee_id_fkey(full_name)')
      .eq('status', 'approved')
      .lte('start_date', today)
      .gte('end_date', today)
    setOffToday(data || [])
  }

  async function fetchDocStats(onboardingData) {
    if (!onboardingData || onboardingData.length === 0) return
    const employeeIds = onboardingData.map(o => o.employees.id)
    const { data } = await supabase
      .from('document_completions')
      .select('employee_id, completed_file_url, completed_file_path')
      .in('employee_id', employeeIds)
      .or('completed_file_url.not.is.null,completed_file_path.not.is.null')

    const stats = {}
    if (data) data.forEach(dc => { stats[dc.employee_id] = (stats[dc.employee_id] || 0) + 1 })
    setDocStats(stats)
  }

  return { onboardings, completedCount, loading, fetchError, docStats, offToday, refetch: fetchOnboardings }
}
