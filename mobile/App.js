import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, Text, View, TouchableOpacity, ScrollView, 
  SafeAreaView, StatusBar, Image, Alert, ActivityIndicator,
  Modal, TextInput 
} from 'react-native';
import { 
  getClasses, getStudents, saveAttendanceDraft, 
  submitFinalAttendance, getWhatsAppStatus, getAttendanceLogs,
  loginAdmin, getAdminInsights, getAdminRecords,
  connectWhatsApp, reconnectWhatsApp, disconnectWhatsApp
} from './src/services/api';


export default function App() {
  const [activeTab, setActiveTab] = useState('attendance');
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [students, setStudents] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [loading, setLoading] = useState(false);
  const [waStatus, setWaStatus] = useState({ status: 'disconnected', qr: '' });
  const [logs, setLogs] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Principal / Admin Authentication State
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const [adminError, setAdminError] = useState('');
  const [insights, setInsights] = useState(null);
  const [adminRecords, setAdminRecords] = useState([]);
  const [loadingAdmin, setLoadingAdmin] = useState(false);

  // Admin Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  useEffect(() => {
    loadClasses();
    checkWhatsAppStatus();
    const interval = setInterval(() => {
      checkWhatsAppStatus();
    }, 5000);

    const clockInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(clockInterval);
    };
  }, []);

  useEffect(() => {
    if (selectedClass) {
      loadStudents(selectedClass);
    }
  }, [selectedClass]);

  useEffect(() => {
    if (activeTab === 'principal' && isAdminLoggedIn) {
      loadAdminDashboard();
    }
  }, [activeTab, isAdminLoggedIn, filterClass, filterStatus, searchQuery]);

  const loadClasses = async () => {
    setLoading(true);
    const classList = await getClasses('unique_scholars');
    setClasses(classList);
    if (classList.length > 0) {
      setSelectedClass(prev => (prev && classList.some(c => c.id === prev)) ? prev : classList[0].id);
    }
    setLoading(false);
  };

  const loadStudents = async (classId) => {
    setLoading(true);
    const list = await getStudents('unique_scholars', classId);
    setStudents(list);
    
    // Initialize default status to Present
    const defaultStatus = {};
    list.forEach(s => {
      defaultStatus[s.id] = 'Present';
    });
    setAttendance(defaultStatus);
    setLoading(false);
  };

  const handleRefresh = async () => {
    setLoading(true);
    const classList = await getClasses('unique_scholars');
    setClasses(classList);
    if (classList.length > 0) {
      const targetClass = (selectedClass && classList.some(c => c.id === selectedClass))
        ? selectedClass
        : classList[0].id;
      setSelectedClass(targetClass);
      await loadStudents(targetClass);
    }
    await checkWhatsAppStatus();
    if (isAdminLoggedIn) {
      await loadAdminDashboard();
    }
    setLoading(false);
  };

  const checkWhatsAppStatus = async () => {
    const statusData = await getWhatsAppStatus();
    setWaStatus(statusData);
  };

  const loadLogs = async () => {
    const logList = await getAttendanceLogs('unique_scholars');
    setLogs(logList);
  };

  const loadAdminDashboard = async () => {
    setLoadingAdmin(true);
    const insightsData = await getAdminInsights('unique_scholars');
    setInsights(insightsData);

    const filters = {};
    if (filterClass) filters.classId = filterClass;
    if (filterStatus) filters.status = filterStatus;
    if (searchQuery) filters.search = searchQuery;

    const recordsData = await getAdminRecords('unique_scholars', filters);
    setAdminRecords(recordsData);
    setLoadingAdmin(false);
  };

  const handleAdminLogin = async (pinToTry = adminPin) => {
    setAdminError('');
    if (!pinToTry) {
      setAdminError('Please enter Principal PIN.');
      return;
    }

    const res = await loginAdmin(pinToTry);
    if (res.success) {
      setIsAdminLoggedIn(true);
      setShowAdminModal(false);
      setAdminPin('');
      setAdminError('');
      setActiveTab('principal');
      Alert.alert('Welcome Principal! 👑', 'Access granted to Executive Attendance Insights & Records.');
    } else {
      setAdminError(res.error || 'Invalid PIN. Default PIN is 1234');
    }
  };

  const handleAdminLogout = () => {
    setIsAdminLoggedIn(false);
    setActiveTab('attendance');
    Alert.alert('Logged Out', 'You have logged out of the Principal Portal.');
  };

  const toggleStatus = (studentId) => {
    setAttendance(prev => {
      const current = prev[studentId] || 'Present';
      const next = current === 'Present' ? 'Absent' : current === 'Absent' ? 'Late' : 'Present';
      return { ...prev, [studentId]: next };
    });
  };

  const markAllPresent = () => {
    const updated = {};
    students.forEach(s => updated[s.id] = 'Present');
    setAttendance(updated);
  };

  const markAllAbsent = () => {
    const updated = {};
    students.forEach(s => updated[s.id] = 'Absent');
    setAttendance(updated);
  };

  const formattedTime = currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  const handleSaveDraft = async () => {
    if (!selectedClass || students.length === 0) return;
    setSubmitting(true);
    
    const payload = {
      schoolId: 'unique_scholars',
      classId: selectedClass,
      date: new Date().toISOString().split('T')[0],
      time: formattedTime,
      attendance: students.map(s => ({
        studentId: s.id,
        name: s.name,
        parentPhone: s.parentPhone,
        parentEmail: s.parentEmail,
        status: attendance[s.id] || 'Present',
        time: formattedTime
      }))
    };

    const res = await saveAttendanceDraft(payload);
    setSubmitting(false);

    if (res.success) {
      Alert.alert('Draft Saved 📝', `Attendance draft saved at ${formattedTime}! Late students can be updated until final submission.`);
    } else {
      Alert.alert('Error', res.error || 'Failed to save draft.');
    }
  };

  const handleSubmitFinal = async () => {
    if (!selectedClass || students.length === 0) return;

    const absentCount = students.filter(s => (attendance[s.id] || 'Present') === 'Absent').length;

    Alert.alert(
      'Final Submission Lock 🔒',
      `Are you sure you want to finalize attendance for ${selectedClass} at ${formattedTime}?\n\nPresent: ${students.length - absentCount}\nAbsent: ${absentCount}\n\nAbsent student parents will automatically receive WhatsApp alerts.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Confirm & Dispatch', 
          style: 'default',
          onPress: async () => {
            setSubmitting(true);
            const payload = {
              schoolId: 'unique_scholars',
              classId: selectedClass,
              date: new Date().toISOString().split('T')[0],
              time: formattedTime,
              attendance: students.map(s => ({
                studentId: s.id,
                name: s.name,
                parentPhone: s.parentPhone,
                parentEmail: s.parentEmail,
                status: attendance[s.id] || 'Present',
                time: formattedTime
              }))
            };

            const res = await submitFinalAttendance(payload);
            setSubmitting(false);

            if (res.success) {
              Alert.alert(
                'Attendance Finalized 🎉',
                `Attendance Locked at ${formattedTime}!\nTotal: ${res.summary.total}\nPresent: ${res.summary.present}\nAbsent: ${res.summary.absent}\nWhatsApp Alerts Sent: ${res.summary.whatsappAlertsSent}`
              );
            } else {
              Alert.alert('Submission Error', res.error || 'Failed to submit attendance.');
            }
          }
        }
      ]
    );
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Present': return '#10b981';
      case 'Absent': return '#ef4444';
      case 'Late': return '#f59e0b';
      default: return '#6b7280';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />

      {/* NAVBAR */}
      <View style={styles.header}>
        <View>
          <Text style={styles.brandTitle}>Unique Scholars</Text>
          <Text style={styles.brandSubtitle}>Mobile Attendance Portal</Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {/* PRINCIPAL ADMIN LOGIN / LOGOUT BUTTON */}
          {isAdminLoggedIn ? (
            <TouchableOpacity 
              style={styles.adminBadgeLoggedIn}
              onPress={() => {
                if (activeTab === 'principal') {
                  handleAdminLogout();
                } else {
                  setActiveTab('principal');
                }
              }}
            >
              <Text style={styles.adminBadgeText}>👑 Principal Active</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              style={styles.adminBadgeBtn}
              onPress={() => setShowAdminModal(true)}
            >
              <Text style={styles.adminBadgeText}>🔑 Login as Admin</Text>
            </TouchableOpacity>
          )}

          {/* WA BADGE - CLICKABLE TO OPEN WHATSAPP INTERFACE */}
          <TouchableOpacity 
            style={[
              styles.waBadge, 
              { backgroundColor: waStatus.status === 'connected' ? '#064e3b' : '#7f1d1d' }
            ]}
            onPress={() => setActiveTab('whatsapp')}
          >
            <View style={[
              styles.statusDot, 
              { backgroundColor: waStatus.status === 'connected' ? '#34d399' : '#f87171' }
            ]} />
            <Text style={styles.waBadgeText}>
              {waStatus.status === 'connected' ? 'WA Online' : 'WA Offline'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* BOTTOM TABS */}
      <View style={styles.tabsRow}>
        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'attendance' && styles.tabActive]}
          onPress={() => setActiveTab('attendance')}
        >
          <Text style={[styles.tabText, activeTab === 'attendance' && styles.tabTextActive]}>
            Attendance
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'whatsapp' && styles.tabActive]}
          onPress={() => setActiveTab('whatsapp')}
        >
          <Text style={[styles.tabText, activeTab === 'whatsapp' && styles.tabTextActive]}>
            WhatsApp
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'logs' && styles.tabActive]}
          onPress={() => { setActiveTab('logs'); loadLogs(); }}
        >
          <Text style={[styles.tabText, activeTab === 'logs' && styles.tabTextActive]}>
            Reports
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'principal' && styles.tabActive]}
          onPress={() => {
            if (isAdminLoggedIn) {
              setActiveTab('principal');
            } else {
              setShowAdminModal(true);
            }
          }}
        >
          <Text style={[styles.tabText, activeTab === 'principal' && styles.tabTextActive, { color: '#f59e0b' }]}>
            👑 Principal
          </Text>
        </TouchableOpacity>
      </View>



      {/* MAIN CONTENT */}
      {activeTab === 'attendance' && (
        <View style={{ flex: 1 }}>
          {/* LIVE DIGITAL CLOCK BAR */}
          <View style={styles.clockBar}>
            <Text style={styles.clockText}>
              📅 {currentTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}  |  🕒 {formattedTime}
            </Text>
          </View>

          {/* CLASS SELECTOR */}
          <View style={styles.classSelectorBar}>
            <Text style={styles.label}>Select Class:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.classList}>
              {classes.map(c => (
                <TouchableOpacity 
                  key={c.id} 
                  style={[styles.classChip, selectedClass === c.id && styles.classChipActive]}
                  onPress={() => setSelectedClass(c.id)}
                >
                  <Text style={[styles.classChipText, selectedClass === c.id && styles.classChipTextActive]}>
                    {c.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* QUICK ACTIONS */}
          <View style={styles.quickActionsBar}>
            <TouchableOpacity style={styles.quickBtnPresent} onPress={markAllPresent}>
              <Text style={styles.quickBtnText}>✅ All Present</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickBtnAbsent} onPress={markAllAbsent}>
              <Text style={styles.quickBtnText}>❌ All Absent</Text>
            </TouchableOpacity>
          </View>

          {/* STUDENT LIST */}
          {loading ? (
            <ActivityIndicator size="large" color="#3b82f6" style={{ marginTop: 40 }} />
          ) : students.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {classes.length === 0 
                  ? "⚠️ Unable to load classes. Ensure backend is running."
                  : `No students found for ${classes.find(c => c.id === selectedClass)?.name || selectedClass}.`}
              </Text>
              <TouchableOpacity style={styles.refreshBtn} onPress={handleRefresh}>
                <Text style={styles.refreshBtnText}>🔄 Tap to Refresh Data</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView style={styles.studentList}>
              {students.map(item => {
                const status = attendance[item.id] || 'Present';
                return (
                  <TouchableOpacity 
                    key={item.id} 
                    style={styles.studentCard} 
                    onPress={() => toggleStatus(item.id)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.studentName}>{item.name}</Text>
                      <Text style={styles.studentDetail}>ID: {item.id}  •  Sec: {item.section || 'Section A'}  •  Parent: {item.parentPhone}</Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(status) }]}>
                      <Text style={styles.statusBadgeText}>{status}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* FOOTER ACTIONS */}
          <View style={styles.bottomBar}>
            <TouchableOpacity 
              style={[styles.btnDraft, submitting && { opacity: 0.5 }]} 
              onPress={handleSaveDraft}
              disabled={submitting}
            >
              <Text style={styles.btnDraftText}>💾 Save Draft</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.btnFinal, submitting && { opacity: 0.5 }]} 
              onPress={handleSubmitFinal}
              disabled={submitting}
            >
              <Text style={styles.btnFinalText}>🚀 Final Submit & Alert</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}


      {activeTab === 'whatsapp' && (

        <ScrollView style={styles.panelPadding}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>📱 WhatsApp Gateway Connection</Text>
            <Text style={styles.cardDesc}>
              Pair school WhatsApp phone to enable parent dispatches. Connected once, saved for both App & Admin Portal!
            </Text>

            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 20 }}>
              <TouchableOpacity 
                style={[styles.refreshBtn, { backgroundColor: '#3b82f6', paddingHorizontal: 15 }]} 
                onPress={async () => {
                  const res = await connectWhatsApp('unique_scholars');
                  setWaStatus(res);
                  let attempts = 0;
                  const timer = setInterval(async () => {
                    attempts += 1;
                    const st = await getWhatsAppStatus();
                    setWaStatus(st);
                    if (st.status === 'connected' || st.qr || attempts > 15) clearInterval(timer);
                  }, 1500);
                }}
              >
                <Text style={styles.refreshBtnText}>⚡ Connect / View QR</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.refreshBtn, { backgroundColor: '#334155', paddingHorizontal: 15 }]} 
                onPress={async () => {
                  const res = await reconnectWhatsApp('unique_scholars');
                  setWaStatus(res);
                }}
              >
                <Text style={styles.refreshBtnText}>🔄 Reconnect</Text>
              </TouchableOpacity>
            </View>

            {waStatus.message ? (
              <View style={{ padding: 14, backgroundColor: 'rgba(245, 158, 11, 0.15)', borderRadius: 12, borderLeftWidth: 4, borderLeftColor: '#f59e0b', marginBottom: 15 }}>
                <Text style={{ color: '#f59e0b', fontWeight: 'bold', fontSize: 13, marginBottom: 4 }}>⚠️ Notice:</Text>
                <Text style={{ color: '#cbd5e1', fontSize: 12, lineHeight: 18 }}>{waStatus.message}</Text>
              </View>
            ) : null}

            {waStatus.qr ? (
              <View style={styles.qrContainer}>
                <Image source={{ uri: waStatus.qr }} style={{ width: 230, height: 230, borderRadius: 12, borderWidth: 4, borderColor: '#ffffff' }} />
                <Text style={styles.qrHint}>Point your WhatsApp phone camera at this QR code</Text>
              </View>
            ) : waStatus.status === 'connected' ? (
              <View style={styles.connectedBox}>
                <Text style={styles.connectedTitle}>✅ WhatsApp Connected & Synced!</Text>
                <Text style={styles.connectedText}>Session is active. Parent alerts & report cards will be sent automatically.</Text>
              </View>
            ) : (
              <View style={{ alignItems: 'center', marginVertical: 20 }}>
                <ActivityIndicator size="large" color="#3b82f6" style={{ marginVertical: 15 }} />
                <Text style={{ color: '#94a3b8', textAlign: 'center', fontSize: 13 }}>
                  {waStatus.status === 'connecting' ? 'Connecting to WhatsApp Gateway...' : 'Tap "Connect / View QR" to generate pairing QR code.'}
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      )}


      {activeTab === 'logs' && (

        <ScrollView style={styles.panelPadding}>
          <Text style={styles.cardTitle}>📊 Attendance History & Logs</Text>
          {logs.map((log, i) => (
            <View key={i} style={styles.logCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={styles.logName}>{log.name}</Text>
                <Text style={[styles.logStatus, { color: getStatusColor(log.status) }]}>{log.status}</Text>
              </View>
              <Text style={styles.logDetail}>
                Class: {log.classId}  •  Date: {log.date}  •  Time: {log.time || 'N/A'}  •  State: {log.state}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}

      {/* PRINCIPAL ADMIN DASHBOARD */}
      {activeTab === 'principal' && (
        <ScrollView style={styles.panelPadding}>
          {/* HEADER SUMMARY CARD */}
          <View style={styles.principalBanner}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={styles.principalBannerTitle}>👑 Principal Executive Portal</Text>
                <Text style={styles.principalBannerSubtitle}>Unique Scholars Academy • Insights & Control</Text>
              </View>
              <TouchableOpacity style={styles.logoutBtn} onPress={handleAdminLogout}>
                <Text style={styles.logoutBtnText}>Logout</Text>
              </TouchableOpacity>
            </View>
          </View>

          {loadingAdmin ? (
            <ActivityIndicator size="large" color="#f59e0b" style={{ marginVertical: 40 }} />
          ) : insights ? (
            <View>
              {/* KEY STATS GRID */}
              <Text style={styles.sectionHeader}>📊 Key Attendance Ratios & Metrics</Text>
              <View style={styles.gridRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Today's Rate</Text>
                  <Text style={styles.statValue}>{insights.today.rate}%</Text>
                  <Text style={styles.statSubText}>{insights.today.present} Present / {insights.today.absent} Absent</Text>
                </View>

                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>This Month ({insights.thisMonth.name.split(' ')[0]})</Text>
                  <Text style={styles.statValue}>{insights.thisMonth.rate}%</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    <Text style={[
                      styles.trendBadge,
                      { color: insights.monthTrendDiff >= 0 ? '#34d399' : '#f87171' }
                    ]}>
                      {insights.monthTrendDiff >= 0 ? `▲ +${insights.monthTrendDiff}%` : `▼ ${insights.monthTrendDiff}%`}
                    </Text>
                    <Text style={styles.statSubText}> vs Past Month</Text>
                  </View>
                </View>
              </View>

              <View style={styles.gridRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Past Month ({insights.pastMonth.name.split(' ')[0]})</Text>
                  <Text style={styles.statValue}>{insights.pastMonth.rate}%</Text>
                  <Text style={styles.statSubText}>{insights.pastMonth.totalRecorded} Total Logs</Text>
                </View>

                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>WhatsApp Dispatches</Text>
                  <Text style={styles.statValue}>{insights.totalAlertsSent}</Text>
                  <Text style={styles.statSubText}>Parent Alerts Sent</Text>
                </View>
              </View>

              {/* CLASS RATIOS BREAKDOWN */}
              <Text style={styles.sectionHeader}>🏫 Class-by-Class Attendance Ratios ({insights.thisMonth.name})</Text>
              {insights.classBreakdown.map((c, i) => (
                <View key={i} style={styles.classRatioCard}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text style={styles.classRatioName}>{c.className}</Text>
                    <Text style={styles.classRatioValue}>{c.attendanceRate}% Attendance</Text>
                  </View>
                  {/* PROGRESS BAR */}
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, { width: `${c.attendanceRate}%`, backgroundColor: c.attendanceRate >= 85 ? '#10b981' : c.attendanceRate >= 70 ? '#f59e0b' : '#ef4444' }]} />
                  </View>
                  <Text style={styles.classRatioMeta}>Students: {c.totalStudents}  •  Absences this Month: {c.totalAbsences}</Text>
                </View>
              ))}

              {/* CRITICAL INSIGHTS: FREQUENT ABSENTEES */}
              <Text style={styles.sectionHeader}>🚨 Principal Alert: Frequent Absentees ({insights.thisMonth.name})</Text>
              {insights.frequentAbsentees.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={{ color: '#34d399', textAlign: 'center' }}>🎉 Perfect Attendance! No frequent absentees this month.</Text>
                </View>
              ) : (
                insights.frequentAbsentees.map((item, idx) => (
                  <View key={idx} style={styles.absenteeCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.absenteeName}>{item.name}</Text>
                      <Text style={styles.absenteeClass}>Class: {item.classId}  •  Student ID: {item.studentId}</Text>
                    </View>
                    <View style={styles.absenteeCountBadge}>
                      <Text style={styles.absenteeCountText}>{item.absentCount} Absents</Text>
                    </View>
                  </View>
                ))
              )}

              {/* ALL RECORDS EXPLORER */}
              <Text style={styles.sectionHeader}>📁 Complete Historical Records Explorer</Text>
              
              {/* SEARCH & FILTERS */}
              <View style={styles.filterBox}>
                <TextInput 
                  style={styles.searchInput}
                  placeholder="🔍 Search student name or ID..."
                  placeholderTextColor="#64748b"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                  <TouchableOpacity 
                    style={[styles.filterChip, !filterClass && styles.filterChipActive]}
                    onPress={() => setFilterClass('')}
                  >
                    <Text style={styles.filterChipText}>All Classes</Text>
                  </TouchableOpacity>
                  {classes.map(c => (
                    <TouchableOpacity 
                      key={c.id} 
                      style={[styles.filterChip, filterClass === c.id && styles.filterChipActive]}
                      onPress={() => setFilterClass(c.id)}
                    >
                      <Text style={styles.filterChipText}>{c.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <View style={{ flexDirection: 'row', marginTop: 8 }}>
                  {['', 'Present', 'Absent', 'Late'].map((st, i) => (
                    <TouchableOpacity 
                      key={i} 
                      style={[styles.filterChip, filterStatus === st && styles.filterChipActive, { marginRight: 6 }]}
                      onPress={() => setFilterStatus(st)}
                    >
                      <Text style={styles.filterChipText}>{st ? st : 'All Status'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* RECORDS LIST */}
              <Text style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>Showing {adminRecords.length} records</Text>
              {adminRecords.slice(0, 30).map((record, i) => (
                <View key={i} style={styles.logCard}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={styles.logName}>{record.name}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(record.status) }]}>
                      <Text style={styles.statusBadgeText}>{record.status}</Text>
                    </View>
                  </View>
                  <Text style={styles.logDetail}>
                    Class: {record.classId}  •  Date: {record.date}  •  Time: {record.time || 'N/A'}  •  State: {record.state}
                  </Text>
                </View>
              ))}

            </View>
          ) : (
            <Text style={{ color: '#ef4444', textAlign: 'center', marginTop: 20 }}>Unable to load Principal insights. Verify backend server status.</Text>
          )}
        </ScrollView>
      )}

      {/* PRINCIPAL ADMIN LOGIN MODAL */}
      <Modal 
        visible={showAdminModal} 
        transparent={true} 
        animationType="slide"
        onRequestClose={() => setShowAdminModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>👑 Principal Admin Login</Text>
            <Text style={styles.modalSub}>Enter your Principal Security PIN to view full attendance ratios, analytics, and records.</Text>

            <TextInput 
              style={styles.pinInput}
              placeholder="Enter PIN (Default: 1234)"
              placeholderTextColor="#64748b"
              keyboardType="numeric"
              secureTextEntry={true}
              maxLength={6}
              value={adminPin}
              onChangeText={setAdminPin}
            />

            {adminError ? <Text style={styles.errorText}>{adminError}</Text> : null}

            <TouchableOpacity 
              style={styles.modalLoginBtn}
              onPress={() => handleAdminLogin()}
            >
              <Text style={styles.modalLoginBtnText}>Unlock Principal Portal</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.modalDemoBtn}
              onPress={() => handleAdminLogin('1234')}
            >
              <Text style={styles.modalDemoBtnText}>⚡ Demo Quick Login (PIN: 1234)</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.modalCloseBtn}
              onPress={() => { setShowAdminModal(false); setAdminError(''); setAdminPin(''); }}
            >
              <Text style={styles.modalCloseBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { 
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', 
    paddingHorizontal: 15, paddingVertical: 15, backgroundColor: '#1e293b' 
  },
  clockBar: {
    backgroundColor: '#1e293b',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    alignItems: 'center'
  },
  clockText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '600'
  },
  brandTitle: { fontSize: 18, fontWeight: 'bold', color: '#f8fafc' },
  brandSubtitle: { fontSize: 11, color: '#94a3b8' },
  adminBadgeBtn: { backgroundColor: '#d97706', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, marginRight: 8 },
  adminBadgeLoggedIn: { backgroundColor: '#059669', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, marginRight: 8 },
  adminBadgeText: { color: '#ffffff', fontSize: 11, fontWeight: 'bold' },
  waBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  waBadgeText: { color: '#ffffff', fontSize: 11, fontWeight: '600' },
  tabsRow: { flexDirection: 'row', backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155' },
  tabButton: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#3b82f6' },
  tabText: { color: '#94a3b8', fontSize: 12, fontWeight: '500' },
  tabTextActive: { color: '#3b82f6', fontWeight: 'bold' },
  classSelectorBar: { padding: 15, backgroundColor: '#0f172a' },
  label: { color: '#94a3b8', fontSize: 13, marginBottom: 8 },
  classList: { flexDirection: 'row' },
  classChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1e293b', marginRight: 10 },
  classChipActive: { backgroundColor: '#3b82f6' },
  classChipText: { color: '#cbd5e1', fontSize: 13 },
  classChipTextActive: { color: '#ffffff', fontWeight: 'bold' },
  quickActionsBar: { flexDirection: 'row', paddingHorizontal: 15, marginBottom: 10 },
  quickBtnPresent: { flex: 1, paddingVertical: 8, backgroundColor: '#064e3b', borderRadius: 8, marginRight: 6, alignItems: 'center' },
  quickBtnAbsent: { flex: 1, paddingVertical: 8, backgroundColor: '#7f1d1d', borderRadius: 8, marginLeft: 6, alignItems: 'center' },
  quickBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
  studentList: { flex: 1, paddingHorizontal: 15 },
  studentCard: { 
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e293b', 
    padding: 15, borderRadius: 12, marginBottom: 10 
  },
  studentName: { fontSize: 16, fontWeight: '600', color: '#f8fafc' },
  studentDetail: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  statusBadge: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12 },
  statusBadgeText: { color: '#ffffff', fontWeight: 'bold', fontSize: 12 },
  bottomBar: { flexDirection: 'row', padding: 15, backgroundColor: '#1e293b', borderTopWidth: 1, borderTopColor: '#334155' },
  btnDraft: { flex: 1, paddingVertical: 14, backgroundColor: '#334155', borderRadius: 10, marginRight: 8, alignItems: 'center' },
  btnDraftText: { color: '#f8fafc', fontWeight: '600', fontSize: 14 },
  btnFinal: { flex: 1.5, paddingVertical: 14, backgroundColor: '#3b82f6', borderRadius: 10, alignItems: 'center' },
  btnFinalText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },
  panelPadding: { padding: 15 },
  card: { backgroundColor: '#1e293b', borderRadius: 16, padding: 20 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#f8fafc', marginBottom: 6 },
  cardDesc: { fontSize: 13, color: '#94a3b8', marginBottom: 20 },
  qrContainer: { alignItems: 'center', marginVertical: 10 },
  qrHint: { color: '#94a3b8', marginTop: 12, fontSize: 12 },
  connectedBox: { padding: 20, backgroundColor: '#064e3b', borderRadius: 12, alignItems: 'center' },
  connectedTitle: { color: '#34d399', fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  connectedText: { color: '#a7f3d0', fontSize: 12 },
  logCard: { backgroundColor: '#1e293b', padding: 15, borderRadius: 10, marginBottom: 10 },
  logName: { fontSize: 15, fontWeight: '600', color: '#f8fafc' },
  logStatus: { fontWeight: 'bold', fontSize: 13 },
  logDetail: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', padding: 30, marginTop: 20 },
  emptyText: { color: '#94a3b8', fontSize: 14, textAlign: 'center', marginBottom: 15 },
  refreshBtn: { backgroundColor: '#3b82f6', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  refreshBtnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },

  // PRINCIPAL DASHBOARD STYLES
  principalBanner: { backgroundColor: '#312e81', borderRadius: 16, padding: 16, marginBottom: 16 },
  principalBannerTitle: { color: '#fbbf24', fontSize: 18, fontWeight: 'bold' },
  principalBannerSubtitle: { color: '#c7d2fe', fontSize: 12, marginTop: 2 },
  logoutBtn: { backgroundColor: '#4338ca', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  logoutBtnText: { color: '#ffffff', fontSize: 12, fontWeight: 'bold' },
  sectionHeader: { color: '#f8fafc', fontSize: 15, fontWeight: 'bold', marginTop: 16, marginBottom: 10 },
  gridRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  statCard: { flex: 1, backgroundColor: '#1e293b', borderRadius: 12, padding: 14, marginHorizontal: 4 },
  statLabel: { color: '#94a3b8', fontSize: 11, fontWeight: '600' },
  statValue: { color: '#38bdf8', fontSize: 22, fontWeight: 'bold', marginVertical: 4 },
  statSubText: { color: '#64748b', fontSize: 10 },
  trendBadge: { fontSize: 11, fontWeight: 'bold' },
  classRatioCard: { backgroundColor: '#1e293b', borderRadius: 12, padding: 14, marginBottom: 10 },
  classRatioName: { color: '#f8fafc', fontWeight: 'bold', fontSize: 15 },
  classRatioValue: { color: '#38bdf8', fontWeight: 'bold', fontSize: 14 },
  progressBarBg: { height: 8, backgroundColor: '#334155', borderRadius: 4, marginVertical: 8, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 4 },
  classRatioMeta: { color: '#94a3b8', fontSize: 11 },
  absenteeCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#7f1d1d', borderRadius: 12, padding: 14, marginBottom: 8 },
  absenteeName: { color: '#ffffff', fontWeight: 'bold', fontSize: 15 },
  absenteeClass: { color: '#fca5a5', fontSize: 11, marginTop: 2 },
  absenteeCountBadge: { backgroundColor: '#991b1b', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  absenteeCountText: { color: '#ffffff', fontWeight: 'bold', fontSize: 12 },
  emptyCard: { backgroundColor: '#064e3b', borderRadius: 12, padding: 15, marginBottom: 10 },
  filterBox: { backgroundColor: '#1e293b', borderRadius: 12, padding: 12, marginBottom: 12 },
  searchInput: { backgroundColor: '#0f172a', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#f8fafc', fontSize: 13 },
  filterChip: { backgroundColor: '#334155', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, marginRight: 6 },
  filterChipActive: { backgroundColor: '#3b82f6' },
  filterChipText: { color: '#ffffff', fontSize: 11, fontWeight: '600' },

  // MODAL STYLES
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', backgroundColor: '#1e293b', borderRadius: 20, padding: 24, alignItems: 'center' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#f59e0b', marginBottom: 8 },
  modalSub: { color: '#94a3b8', fontSize: 13, textAlign: 'center', marginBottom: 20 },
  pinInput: { width: '100%', backgroundColor: '#0f172a', borderRadius: 12, padding: 14, color: '#f8fafc', fontSize: 18, textAlign: 'center', letterSpacing: 4, marginBottom: 12 },
  errorText: { color: '#ef4444', fontSize: 12, marginBottom: 12 },
  modalLoginBtn: { width: '100%', backgroundColor: '#f59e0b', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  modalLoginBtnText: { color: '#0f172a', fontWeight: 'bold', fontSize: 15 },
  modalDemoBtn: { width: '100%', backgroundColor: '#334155', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginBottom: 12 },
  modalDemoBtnText: { color: '#38bdf8', fontWeight: '600', fontSize: 13 },
  modalCloseBtn: { paddingVertical: 8 },
  modalCloseBtnText: { color: '#94a3b8', fontSize: 13 }
});

