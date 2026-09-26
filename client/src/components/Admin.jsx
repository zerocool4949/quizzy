import { useState, useEffect, useCallback, useRef } from 'react'

const API_URL = import.meta.env.VITE_SOCKET_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001')

function getAdminKey() {
  return new URLSearchParams(window.location.search).get('key') || ''
}

function adminFetch(url, options = {}) {
  const key = getAdminKey()
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': key,
      ...options.headers
    }
  })
}

// Parse a track entry (string or object) into a consistent shape
function parseTrack(track) {
  if (typeof track === 'string') return { name: track, search: '' }
  if (track && typeof track === 'object') return { name: track.name || '', search: track.search || '' }
  return { name: '', search: '' }
}

// Convert back to JSON format (plain string or object with search)
function serializeTrack(name, search) {
  if (search.trim()) return { name, search }
  return name
}

function slugify(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function getClipUrl(movieName, trackName) {
  return `${API_URL}/audio/${slugify(movieName)}__${slugify(trackName)}.mp3`
}

const inputClass = 'w-full px-2 py-1 text-sm bg-slate-900 border border-slate-600 rounded-sm focus:outline-hidden focus:border-teal-500'

export default function Admin() {
  const [tab, setTab] = useState('movies')
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [editingKey, setEditingKey] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [addForm, setAddForm] = useState(null)
  const [playing, setPlaying] = useState(null)
  const [redownloading, setRedownloading] = useState(null)
  const audioRef = useRef(null)
  const addFormRef = useRef(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await adminFetch(`${API_URL}/api/admin/${tab}`)
      if (!res.ok) {
        if (res.status === 401) {
          setError('Unauthorized - your IP is not allowed and no valid ?key= was given')
        } else {
          setError('Failed to load data')
        }
        setData({})
        return
      }
      setData(await res.json())
    } catch {
      setError('Connection error')
      setData({})
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => {
    fetchData()
    setEditingKey(null)
    setEditForm(null)
    setAddForm(null)
  }, [fetchData])

  useEffect(() => {
    if (addForm && addFormRef.current) {
      addFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [addForm])

  const persistData = async (newData) => {
    setData(newData)
    setSaving(true)
    setSaveMsg('')
    try {
      const sorted = Object.keys(newData).sort((a, b) => a.localeCompare(b))
        .reduce((obj, key) => { obj[key] = newData[key]; return obj }, {})
      const res = await adminFetch(`${API_URL}/api/admin/${tab}`, {
        method: 'PUT',
        body: JSON.stringify(sorted)
      })
      const result = await res.json()
      if (!res.ok) {
        setSaveMsg(result.error || 'Save failed')
      } else {
        setSaveMsg(`Saved (${result.count} entries)`)
        setData(sorted)
        setTimeout(() => setSaveMsg(''), 3000)
      }
    } catch {
      setSaveMsg('Connection error')
    } finally {
      setSaving(false)
    }
  }

  // Inline edit
  const startEdit = (entryKey) => {
    const entry = data[entryKey]
    if (!entry) return
    const track = parseTrack(entry.tracks?.[0])
    setEditingKey(entryKey)
    setEditForm({
      name: entryKey,
      trackName: track.name,
      trackSearch: track.search,
      composer: entry.composer || '',
      year: entry.year ? String(entry.year) : ''
    })
    setAddForm(null)
  }

  const cancelEdit = () => {
    setEditingKey(null)
    setEditForm(null)
  }

  const saveEdit = () => {
    if (!editForm?.name.trim() || !editForm?.trackName.trim()) return
    const newData = { ...data }
    // If name changed, remove old key
    if (editingKey !== editForm.name.trim()) {
      delete newData[editingKey]
    }
    const track = serializeTrack(editForm.trackName.trim(), editForm.trackSearch.trim())
    newData[editForm.name.trim()] = {
      tracks: [track],
      composer: editForm.composer.trim(),
      year: editForm.year ? parseInt(editForm.year, 10) : null
    }
    setEditingKey(null)
    setEditForm(null)
    persistData(newData)
  }

  // Add new
  const openAdd = () => {
    setAddForm({ name: '', trackName: '', trackSearch: '', composer: '', year: '' })
    cancelEdit()
  }

  const saveAdd = () => {
    if (!addForm?.name.trim() || !addForm?.trackName.trim()) return
    const newData = { ...data }
    const track = serializeTrack(addForm.trackName.trim(), addForm.trackSearch.trim())
    newData[addForm.name.trim()] = {
      tracks: [track],
      composer: addForm.composer.trim(),
      year: addForm.year ? parseInt(addForm.year, 10) : null
    }
    setAddForm(null)
    persistData(newData)
  }

  const deleteEntry = (entryKey) => {
    if (!confirm(`Delete "${entryKey}"?`)) return
    const newData = { ...data }
    delete newData[entryKey]
    if (editingKey === entryKey) cancelEdit()
    persistData(newData)
  }

  const redownload = async (entryKey) => {
    setRedownloading(entryKey)
    try {
      const res = await adminFetch(`${API_URL}/api/admin/redownload`, {
        method: 'POST',
        body: JSON.stringify({ type: tab, name: entryKey })
      })
      const result = await res.json()
      if (result.success) {
        setSaveMsg(`Re-downloaded clip for "${entryKey}"`)
      } else {
        setSaveMsg(`Failed to re-download "${entryKey}"`)
      }
      setTimeout(() => setSaveMsg(''), 3000)
    } catch {
      setSaveMsg('Connection error')
    } finally {
      setRedownloading(null)
    }
  }

  const togglePlay = (entryKey, trackName) => {
    if (playing === entryKey) {
      audioRef.current?.pause()
      audioRef.current = null
      setPlaying(null)
      return
    }
    audioRef.current?.pause()
    const audio = new Audio(getClipUrl(entryKey, trackName))
    audio.onended = () => setPlaying(null)
    audio.play()
    audioRef.current = audio
    setPlaying(entryKey)
  }

  useEffect(() => {
    return () => { audioRef.current?.pause() }
  }, [tab])

  const entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b))
  const label = tab === 'movies' ? 'Movie' : 'Video Game'

  return (
    <div className="min-h-screen flex flex-col items-center p-4">
      <div className="w-full max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Admin</h1>
          <a href="/" className="text-sm text-slate-400 hover:text-slate-200">Back to Quizzy</a>
        </div>

        {/* Tab toggle */}
        <div className="flex bg-slate-900 rounded-lg p-0.5 mb-6">
          <button
            onClick={() => setTab('movies')}
            className={`flex-1 px-4 py-2 rounded-md text-sm transition-colors ${
              tab === 'movies' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Movies ({tab === 'movies' ? entries.length : '...'})
          </button>
          <button
            onClick={() => setTab('videogames')}
            className={`flex-1 px-4 py-2 rounded-md text-sm transition-colors ${
              tab === 'videogames' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Video Games ({tab === 'videogames' ? entries.length : '...'})
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-600/20 border border-rose-600/30 text-rose-200 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center text-slate-400 py-12">Loading...</div>
        ) : (
          <>
            {/* Action bar */}
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={openAdd}
                className="px-4 py-2 rounded-lg text-sm bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
              >
                + Add {label}
              </button>
              <div className="flex items-center gap-3">
                {saveMsg && (
                  <span className={`text-sm ${saveMsg.includes('Saved') || saveMsg.includes('Re-downloaded') ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {saveMsg}
                  </span>
                )}
                {saving && <span className="text-sm text-slate-400">Saving...</span>}
              </div>
            </div>

            {/* Add form */}
            {addForm && (
              <div ref={addFormRef} className="mb-4 p-4 bg-slate-800/80 rounded-xl border border-slate-600 space-y-3">
                <h3 className="font-semibold text-sm text-slate-300">Add {label}</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{label} Name *</label>
                    <input type="text" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                      className={inputClass} placeholder="e.g. Jurassic Park" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Composer</label>
                    <input type="text" value={addForm.composer} onChange={(e) => setAddForm({ ...addForm, composer: e.target.value })}
                      className={inputClass} placeholder="e.g. John Williams" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Track Name *</label>
                    <input type="text" value={addForm.trackName} onChange={(e) => setAddForm({ ...addForm, trackName: e.target.value })}
                      className={inputClass} placeholder="e.g. Main Theme" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Year</label>
                    <input type="number" value={addForm.year} onChange={(e) => setAddForm({ ...addForm, year: e.target.value })}
                      className={inputClass} placeholder="e.g. 1993" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-slate-400 mb-1">YouTube Search Override <span className="text-slate-500">(optional)</span></label>
                    <input type="text" value={addForm.trackSearch} onChange={(e) => setAddForm({ ...addForm, trackSearch: e.target.value })}
                      className={inputClass} placeholder="e.g. John Williams Jurassic Park Theme" />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setAddForm(null)}
                    className="px-4 py-2 rounded-lg text-sm bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors">
                    Cancel
                  </button>
                  <button onClick={saveAdd} disabled={!addForm.name.trim() || !addForm.trackName.trim()}
                    className="px-4 py-2 rounded-lg text-sm bg-teal-600 text-white hover:bg-teal-500 transition-colors disabled:opacity-50">
                    Add & Save
                  </button>
                </div>
              </div>
            )}

            {/* Table */}
            <div className="bg-slate-900/60 rounded-xl border border-slate-700 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase">
                    <th className="text-left px-3 py-3">Name</th>
                    <th className="text-left px-3 py-3">Track</th>
                    <th className="text-left px-3 py-3">Search</th>
                    <th className="text-left px-3 py-3">Composer</th>
                    <th className="text-left px-3 py-3 w-14">Year</th>
                    <th className="text-right px-3 py-3 w-52">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([key, entry]) => {
                    const track = parseTrack(entry.tracks?.[0])
                    const isEditing = editingKey === key

                    if (isEditing) {
                      return (
                        <tr key={key} className="border-b border-teal-800 bg-slate-800/60">
                          <td className="px-3 py-2">
                            <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                              className={inputClass} />
                          </td>
                          <td className="px-3 py-2">
                            <input type="text" value={editForm.trackName} onChange={(e) => setEditForm({ ...editForm, trackName: e.target.value })}
                              className={inputClass} />
                          </td>
                          <td className="px-3 py-2">
                            <input type="text" value={editForm.trackSearch} onChange={(e) => setEditForm({ ...editForm, trackSearch: e.target.value })}
                              className={inputClass} placeholder="auto" />
                          </td>
                          <td className="px-3 py-2">
                            <input type="text" value={editForm.composer} onChange={(e) => setEditForm({ ...editForm, composer: e.target.value })}
                              className={inputClass} />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" value={editForm.year} onChange={(e) => setEditForm({ ...editForm, year: e.target.value })}
                              className={inputClass + ' w-16'} />
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <button onClick={saveEdit} disabled={!editForm.name.trim() || !editForm.trackName.trim()}
                              className="text-emerald-400 hover:text-emerald-300 text-xs mr-3 disabled:opacity-50">
                              Save
                            </button>
                            <button onClick={cancelEdit}
                              className="text-slate-400 hover:text-slate-300 text-xs">
                              Cancel
                            </button>
                          </td>
                        </tr>
                      )
                    }

                    return (
                      <tr key={key} className="border-b border-slate-800 hover:bg-slate-800/40">
                        <td className="px-3 py-2.5 font-medium">{key}</td>
                        <td className="px-3 py-2.5 text-slate-300">{track.name}</td>
                        <td className="px-3 py-2.5 text-slate-500 text-xs">{track.search || <span className="text-slate-600">auto</span>}</td>
                        <td className="px-3 py-2.5 text-slate-400">{entry.composer}</td>
                        <td className="px-3 py-2.5 text-slate-500">{entry.year}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <button onClick={() => togglePlay(key, track.name)}
                            className={`text-xs mr-3 px-1.5 py-0.5 rounded-sm border ${playing === key ? 'border-green-400 text-green-300 bg-green-900/30' : 'border-green-700 text-green-500 hover:text-green-400 hover:border-green-500'}`}>
                            {playing === key ? 'Stop' : 'Play'}
                          </button>
                          <button onClick={() => redownload(key)} disabled={redownloading === key}
                            className="text-amber-400 hover:text-amber-300 text-xs mr-3 disabled:opacity-50">
                            {redownloading === key ? '...' : 'Re-dl'}
                          </button>
                          <button onClick={() => startEdit(key)}
                            className="text-teal-400 hover:text-teal-300 text-xs mr-3">
                            Edit
                          </button>
                          <button onClick={() => deleteEntry(key)}
                            className="text-rose-400 hover:text-rose-300 text-xs">
                            Delete
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {entries.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                        No entries yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-500 mt-4 text-center">
              {entries.length} {tab === 'movies' ? 'movies' : 'video games'} total
            </p>
          </>
        )}
      </div>
    </div>
  )
}
