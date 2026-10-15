const $ = (s) => document.querySelector(s);
const state = { rooms: [], bookings: [], dates: false };
const money = n => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function notify(message, type = 'success') { const n = $('#notice'); n.textContent = message; n.className = `notice ${type}`; n.hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => { n.hidden = true; }, 6500); }
function updateStats() {
  $('#totalRooms').textContent = state.rooms.length;
  $('#availableRooms').textContent = state.rooms.filter(r => r.available !== false).length;
  $('#activeBookings').textContent = state.bookings.filter(b => b.status === 'Booked').length;
  $('#roomTypes').textContent = new Set(state.rooms.map(r => r.type)).size;
}
function renderRooms() {
  const term = $('#searchText').value.trim().toLowerCase();
  const type = $('#typeFilter').value;
  const rooms = state.rooms.filter(r => (type === 'All types' || r.type === type) && (`${r.roomNo} ${r.type}`).toLowerCase().includes(term));
  $('#roomRows').innerHTML = rooms.length ? rooms.map(r => `<tr><td><span class="room-no">${escapeHtml(r.roomNo)}</span></td><td>${escapeHtml(r.type)}</td><td>${money(r.price)}</td><td><span class="pill ${r.available === false ? 'occupied' : 'available'}">${r.available === false ? 'Reserved' : 'Available'}</span></td><td><button class="row-action" data-delete-room="${escapeHtml(r.id)}" title="Delete room">Delete</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">No rooms found. Add your first room to get started.</td></tr>';
  const select = $('#bookingRoom'); const current = select.value;
  const available = state.rooms.filter(r => r.available !== false);
  select.innerHTML = '<option value="">Select a room</option>' + available.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.roomNo)} · ${escapeHtml(r.type)} · ${money(r.price)}/night</option>`).join('');
  if (available.some(r => r.id === current)) select.value = current;
  updateStats();
}
function renderBookings() {
  const rows = $('#bookingRows');
  rows.innerHTML = state.bookings.length ? state.bookings.map(b => `<tr><td><span class="room-no">${escapeHtml(b.guestName)}</span></td><td>${escapeHtml(b.roomNo)} <span style="color:#94a098">· ${escapeHtml(b.roomType)}</span></td><td>${escapeHtml(b.checkIn)} <span style="color:#a0aaa4">→</span> ${escapeHtml(b.checkOut)}</td><td><span class="pill ${b.status === 'Booked' ? 'booked' : 'cancelled'}">${escapeHtml(b.status)}</span></td><td>${b.status === 'Booked' ? `<button class="row-action" data-cancel="${escapeHtml(b.id)}">Cancel</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">No reservations yet. Your confirmed bookings will appear here.</td></tr>';
  updateStats();
}
async function refresh() {
  try {
    const params = new URLSearchParams();
    if ($('#checkIn').value && $('#checkOut').value && $('#checkIn').value < $('#checkOut').value) { params.set('checkIn', $('#checkIn').value); params.set('checkOut', $('#checkOut').value); }
    if ($('#typeFilter').value !== 'All types') params.set('type', $('#typeFilter').value);
    const [rooms, bookings] = await Promise.all([api(`/api/rooms${params.size ? `?${params}` : ''}`), api('/api/bookings')]);
    state.rooms = rooms; state.bookings = bookings; renderRooms(); renderBookings();
    $('#stayNote').textContent = params.has('checkIn') ? `${rooms.filter(r => r.available).length} room(s) available for your selected dates.` : 'Choose your dates to check availability.';
  } catch (e) {
    $('#roomRows').innerHTML = `<tr><td colspan="5" class="empty">Could not load data. ${escapeHtml(e.message)}<br>Configure MONGODB_URI in your environment, then refresh.</td></tr>`;
    $('#bookingRows').innerHTML = '<tr><td colspan="5" class="empty">Database connection required to show reservations.</td></tr>';
    $('#stayNote').textContent = 'Connect MongoDB Atlas to enable booking.';
    notify(e.message, 'error');
  }
}
$('#toggleRoomForm').addEventListener('click', () => { $('#roomForm').hidden = !$('#roomForm').hidden; if (!$('#roomForm').hidden) $('#roomForm').elements.roomNo.focus(); });
$('#roomForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = new FormData(e.currentTarget);
  try { await api('/api/rooms', { method: 'POST', body: JSON.stringify({ roomNo: f.get('roomNo'), type: f.get('type'), price: Number(f.get('price')) }) }); e.currentTarget.reset(); e.currentTarget.hidden = true; notify('Room added successfully.'); await refresh(); }
  catch (err) { notify(err.message, 'error'); }
});
$('#bookingForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = new FormData(e.currentTarget);
  try { await api('/api/bookings', { method: 'POST', body: JSON.stringify({ guestName: f.get('guestName'), roomId: f.get('roomId'), checkIn: f.get('checkIn'), checkOut: f.get('checkOut') }) }); e.currentTarget.reset(); $('#stayNote').textContent = 'Booking confirmed. Choose dates to check availability.'; notify('Reservation confirmed successfully.'); await refresh(); }
  catch (err) { notify(err.message, 'error'); }
});
document.addEventListener('click', async e => {
  const cancel = e.target.closest('[data-cancel]'); const del = e.target.closest('[data-delete-room]');
  if (cancel) { if (!confirm('Cancel this reservation?')) return; try { await api(`/api/bookings/${cancel.dataset.cancel}`, { method: 'DELETE' }); notify('Reservation cancelled.'); await refresh(); } catch (err) { notify(err.message, 'error'); } }
  if (del) { if (!confirm('Delete this room? Rooms with active bookings cannot be deleted.')) return; try { await api(`/api/rooms/${del.dataset.deleteRoom}`, { method: 'DELETE' }); notify('Room deleted.'); await refresh(); } catch (err) { notify(err.message, 'error'); } }
});
$('#searchText').addEventListener('input', renderRooms);
$('#typeFilter').addEventListener('change', refresh);
$('#checkIn').addEventListener('change', () => { $('#checkOut').min = $('#checkIn').value; if ($('#checkOut').value && $('#checkOut').value <= $('#checkIn').value) $('#checkOut').value = ''; refresh(); });
$('#checkOut').addEventListener('change', refresh);
const today = new Date(); const localToday = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`; $('#checkIn').min = localToday; $('#checkOut').min = localToday;
refresh();
