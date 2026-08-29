/**
 * 班級訂午餐系統｜Google Apps Script 後端
 *
 * 部署前請先執行 setupSystem()；再於「專案設定 > 指令碼屬性」設定：
 * SPREADSHEET_ID、FRONTEND_URL、ADMIN_AUTH_CODE、DEVELOPER_MASTER_KEY、PASSWORD_SALT。
 * 此檔案使用訂餐資料表與 DeveloperAccounts 開發者帳號表；短期登入與提醒去重使用 Script Cache / Script Properties。
 */

var SHEETS = {
  Classes: ['ClassID', 'ClassName', 'EmailDomain', 'IsDisabled', 'CreatedAt', 'CreatedBy'],
  DeveloperCodes: ['CodeID', 'CodeHash', 'ClassName', 'IsUsed', 'CreatedAt', 'UsedAt', 'UsedBy'],
  DeveloperAccounts: ['DeveloperID', 'Username', 'Email', 'PasswordHash', 'IsActive', 'CreatedAt', 'LastLoginAt'],
  InviteCodes: ['InviteCodeID', 'ClassID', 'CodeHash', 'Label', 'IsDisabled', 'CreatedAt', 'CreatedBy'],
  Users: ['ID', 'StudentNo', 'Email', 'Name', 'SeatNo', 'PasswordHash', 'Role', 'ClassID', 'WalletBalance', 'IsDisabled', 'EmailVerified', 'EmailVerificationCodeHash', 'EmailVerificationExpiresAt'],
  Stores: ['StoreID', 'ClassID', 'Name'],
  MenuItems: ['ItemID', 'StoreID', 'Name', 'BasePrice'],
  ItemOptions: ['OptionID', 'ItemID', 'OptionName', 'PriceAdjustment'],
  Sessions: ['SessionID', 'ClassID', 'OrderDate', 'StoreID', 'CutoffTime', 'PaymentMode'],
  Orders: ['OrderID', 'SessionID', 'UserID', 'TotalPrice', 'PaymentStatus', 'PickupStatus', 'Note', 'Options', 'CreatedAt'],
  Transactions: ['TransID', 'UserID', 'AdminID', 'Amount', 'Type (TopUp/Deduct)', 'Timestamp'],
  Verification: ['UserID', 'PIN', 'Type (pickup/checkout/topup)', 'ExpiresAt'],
  ResetTokens: ['TokenID', 'UserID', 'ExpiresAt']
};

var SESSION_SECONDS = 21600; // 六小時；使用者可隨時重新登入。
var VERIFY_MINUTES = 5;
var RESET_MINUTES = 15;

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'health';
  if (action === 'health') return respond({ ok: true, data: { service: 'class-lunch-api', now: nowIso() } });
  return respond({ ok: false, error: '僅支援 POST API；請使用前端應用程式。' });
}

function doPost(e) {
  try {
    var body = parseBody(e);
    if (!body.action) throw appError('BAD_REQUEST', '缺少 action。');
    var data = route(body.action, body.data || {}, body.token || '');
    return respond({ ok: true, data: data });
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return respond({ ok: false, error: publicError(err) });
  }
}

function route(action, data, token) {
  switch (action) {
    case 'getPublicConfig': return getPublicConfig();
    case 'register': return register(data);
    case 'verifyRegistration': return verifyRegistration(data);
    case 'resendRegistrationVerification': return resendRegistrationVerification(data);
    case 'login': return login(data);
    case 'logout': return logout(token);
    case 'requestPasswordReset': return requestPasswordReset(data);
    case 'resetPassword': return resetPassword(data);
    case 'getBootstrap': return getBootstrap(token);
    case 'getOpenSessions': return getOpenSessions(token);
    case 'placeOrder': return placeOrder(token, data);
    case 'updateOwnOrder': return updateOwnOrder(token, data);
    case 'deleteOwnOrder': return deleteOwnOrder(token, data);
    case 'getWalletHistory': return getWalletHistory(token);
    case 'createVerification': return createVerification(token, data);
    case 'upgradeAdmin': return upgradeAdmin(token, data);
    case 'getAdminDashboard': return getAdminDashboard(token, data);
    case 'adminResolveVerification': return adminResolveVerification(token, data);
    case 'adminConfirmPickup': return adminConfirmPickup(token, data);
    case 'adminSettleCash': return adminSettleCash(token, data);
    case 'adminTopUp': return adminTopUp(token, data);
    case 'adminCatalog': return adminCatalog(token);
    case 'adminSaveStore': return adminSaveStore(token, data);
    case 'adminDeleteStore': return adminDeleteStore(token, data);
    case 'adminSaveMenuItem': return adminSaveMenuItem(token, data);
    case 'adminDeleteMenuItem': return adminDeleteMenuItem(token, data);
    case 'adminSaveItemOption': return adminSaveItemOption(token, data);
    case 'adminDeleteItemOption': return adminDeleteItemOption(token, data);
    case 'adminSaveSession': return adminSaveSession(token, data);
    case 'adminUpdateSessionCutoff': return adminUpdateSessionCutoff(token, data);
    case 'adminCloseSession': return adminCloseSession(token, data);
    case 'adminDeleteSession': return adminDeleteSession(token, data);
    case 'adminListUsers': return adminListUsers(token);
    case 'adminSetUserDisabled': return adminSetUserDisabled(token, data);
    case 'adminDeleteUser': return adminDeleteUser(token, data);
    case 'adminGetSettings': return adminGetSettings(token);
    case 'adminGetEmailDiagnostics': return adminGetEmailDiagnostics(token);
    case 'adminListInviteCodes': return adminListInviteCodes(token);
    case 'adminCreateInviteCode': return adminCreateInviteCode(token, data);
    case 'adminDisableInviteCode': return adminDisableInviteCode(token, data);
    case 'developerRegister': return developerRegister(data);
    case 'developerLogin': return developerLogin(data);
    case 'developerLogout': return developerLogout(token);
    case 'developerListClassAdminCodes': return developerListClassAdminCodes(token);
    case 'developerIssueClassAdminCode': return developerIssueClassAdminCode(token, data);
    case 'developerRevokeClassAdminCode': return developerRevokeClassAdminCodeForSession(token, data);
    case 'developerListUsers': return developerListUsers(token);
    case 'developerGetUserDetails': return developerGetUserDetails(token, data);
    case 'developerSetUserDisabled': return developerSetUserDisabled(token, data);
    case 'developerDeleteUser': return developerDeleteUser(token, data);
    case 'developerGetSettings': return developerGetSettings(token);
    case 'developerSaveSettings': return developerSaveSettings(token, data);
    case 'adminSaveSettings': return adminSaveSettings(token, data);
    default: throw appError('UNKNOWN_ACTION', '不支援的操作。');
  }
}

// -----------------------------------------------------------------------------
// 初始設定、工作表與觸發器
// -----------------------------------------------------------------------------

function setupSystemFresh(confirmText) {
  if (String(confirmText || '') !== 'DELETE_ALL_DATA') throw new Error('這是破壞性初始化。請明確傳入 DELETE_ALL_DATA 才會清除現有資料。');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('請將此指令碼綁定到目標 Google 試算表後再執行 setupSystemFresh(\'DELETE_ALL_DATA\')。');
  Object.keys(SHEETS).forEach(function(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getMaxRows() > 1) sh.getRange(2, 1, sh.getMaxRows() - 1, Math.max(sh.getLastColumn(), SHEETS[name].length)).clearContent();
    sh.clearFormats();
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold').setBackground('#173B62').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  });
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  if (!props.getProperty('PASSWORD_SALT')) props.setProperty('PASSWORD_SALT', Utilities.getUuid() + Utilities.getUuid());
  createHourlyReminderTrigger();
  return '已清除並重建多班級資料表。請先使用 developerGenerateClassAdminCode(班級名稱) 產生第一組班級管理者代碼。';
}

function setupSystem() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('請將此指令碼綁定到目標 Google 試算表後再執行 setupSystem()。');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  Object.keys(SHEETS).forEach(function(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var headers = SHEETS[name];
    if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (sh.getLastRow() >= 1) {
      var current = sh.getRange(1, 1, 1, headers.length).getValues()[0];
      if (current.join('|') !== headers.join('|')) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#173B62').setFontColor('#ffffff');
  });
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PASSWORD_SALT')) props.setProperty('PASSWORD_SALT', Utilities.getUuid() + Utilities.getUuid());
  createHourlyReminderTrigger();
  return '已完成 9 張工作表與每小時提醒觸發器初始化。請再設定 FRONTEND_URL 與 ADMIN_AUTH_CODE。';
}

function createHourlyReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'sendCutoffReminders') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('sendCutoffReminders').timeBased().everyHours(1).create();
}

/** 每小時執行一次；在各場次截止前 12 小時，對尚未下單的學生各寄送一次提醒。 */
function sendCutoffReminders() {
  var now = new Date();
  var limit = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  var cache = PropertiesService.getScriptProperties();
  var sessions = readRows('Sessions').filter(function(s) {
    var cutoff = dateValue(s.CutoffTime);
    return cutoff && cutoff > now && cutoff <= limit;
  });
  if (!sessions.length) return;
  var users = readRows('Users').filter(function(u) { return !boolValue(u.IsDisabled); });
  var orders = readRows('Orders');
  sessions.forEach(function(session) {
    var cutoff = dateValue(session.CutoffTime);
    users.filter(function(user) { return String(user.ClassID || '') === String(session.ClassID || ''); }).forEach(function(user) {
      var hasOrder = orders.some(function(order) {
        return String(order.SessionID) === String(session.SessionID) && String(order.UserID) === String(user.ID);
      });
      var key = 'reminder_' + session.SessionID + '_' + user.ID;
      if (hasOrder || cache.getProperty(key)) return;
      var subject = '【班級訂午餐】' + formatDate(session.OrderDate) + ' 的訂餐即將截止';
      var body = user.Name + ' 同學，您好：\n\n'
        + formatDate(session.OrderDate) + ' 的午餐尚未完成點餐。\n'
        + '截止時間：' + formatDateTime(cutoff) + '\n\n'
        + '請於截止前開啟訂餐系統完成選餐。\n\n班級訂午餐系統';
      GmailApp.sendEmail(String(user.Email), subject, body);
      cache.setProperty(key, nowIso());
    });
  });
}

// -----------------------------------------------------------------------------
// 身份、登入、重設密碼
// -----------------------------------------------------------------------------

function getPublicConfig() {
  return { emailDomain: '', registrationRequiresEmail: true, registrationRequiresInviteOrAdminCode: true };
}

function register(data) {
  var studentNo = requiredText(data.studentNo, '學號').replace(/\s/g, '');
  var name = requiredText(data.name, '姓名');
  var seatNo = requiredText(data.seatNo, '座號');
  var email = requiredText(data.email, '電子郵件').toLowerCase();
  var password = requiredText(data.password, '密碼');
  var inviteCode = String(data.inviteCode || '').trim();
  var classAdminCode = String(data.classAdminCode || '').trim();
  if (!/^\d{3,30}$/.test(studentNo)) throw appError('INVALID_STUDENT_NO', '學號須為 3–30 位數字。');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw appError('INVALID_EMAIL', '電子郵件格式不正確。');
  if (password.length < 8) throw appError('WEAK_PASSWORD', '密碼至少須為 8 個字元。');
  if ((inviteCode && classAdminCode) || (!inviteCode && !classAdminCode)) throw appError('MISSING_CLASS_CODE', '請輸入邀請碼或班級管理者代碼其中一種。');
  return withLock(function() {
    if (findOne('Users', 'StudentNo', studentNo)) throw appError('DUPLICATE_STUDENT', '此學號已註冊。');
    var classId, role = 'Student';
    if (classAdminCode) {
      var developerCode = findOne('DeveloperCodes', 'CodeHash', inviteCodeHash(classAdminCode));
      if (!developerCode || boolValue(developerCode.IsUsed)) throw appError('INVALID_CLASS_ADMIN_CODE', '班級管理者代碼無效或已使用。');
      classId = newId();
      appendRow('Classes', { ClassID: classId, ClassName: requiredText(developerCode.ClassName, '班級名稱'), EmailDomain: '', IsDisabled: false, CreatedAt: nowIso(), CreatedBy: 'developer' });
      updateRow('DeveloperCodes', 'CodeID', developerCode.CodeID, { IsUsed: true, UsedAt: nowIso(), UsedBy: studentNo });
      role = 'Admin';
    } else {
      var invite = findOne('InviteCodes', 'CodeHash', inviteCodeHash(inviteCode));
      if (!invite || boolValue(invite.IsDisabled)) throw appError('INVALID_INVITE_CODE', '邀請碼無效或已停用。');
      classId = String(invite.ClassID);
      if (!findOne('Classes', 'ClassID', classId) || boolValue(findOne('Classes', 'ClassID', classId).IsDisabled)) throw appError('CLASS_DISABLED', '此班級目前無法加入。');
    }
    var id = newId();
    appendRow('Users', {
      ID: id, StudentNo: studentNo, Email: email, Name: name, SeatNo: seatNo,
      PasswordHash: passwordHash(password), Role: role, ClassID: classId, WalletBalance: 0, IsDisabled: false,
      EmailVerified: false, EmailVerificationCodeHash: '', EmailVerificationExpiresAt: ''
    });
    var user = findOne('Users', 'ID', id);
    var verification = issueRegistrationVerification(user);
    return { verificationRequired: true, studentNo: studentNo, email: email, classId: classId, role: role, expiresAt: verification.expiresAt, delivery: verification };
  });
}

function verifyRegistration(data) {
  var studentNo = requiredText(data.studentNo, '學號').replace(/\s/g, '');
  var code = requiredText(data.code, '信箱驗證碼').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) throw appError('INVALID_EMAIL_CODE', '信箱驗證碼應為 6 位數字。');
  return withLock(function() {
    var user = findOne('Users', 'StudentNo', studentNo);
    if (!user || boolValue(user.IsDisabled)) throw appError('INVALID_EMAIL_CODE', '驗證碼無效或帳號無法使用。');
    if (boolValue(user.EmailVerified)) return { verified: true, message: '此信箱已完成驗證，請直接登入。' };
    var expiresAt = dateValue(user.EmailVerificationExpiresAt);
    if (!expiresAt || expiresAt <= new Date() || String(user.EmailVerificationCodeHash) !== registrationCodeHash(studentNo, code)) {
      throw appError('EMAIL_CODE_EXPIRED', '驗證碼錯誤或已失效，請重新寄送。');
    }
    updateRow('Users', 'ID', user.ID, { EmailVerified: true, EmailVerificationCodeHash: '', EmailVerificationExpiresAt: '' });
    return { verified: true, message: '信箱驗證成功，現在可以登入。' };
  });
}

function resendRegistrationVerification(data) {
  var studentNo = requiredText(data.studentNo, '學號').replace(/\s/g, '');
  return withLock(function() {
    var user = findOne('Users', 'StudentNo', studentNo);
    var verification = null;
    if (user && !boolValue(user.IsDisabled) && !boolValue(user.EmailVerified)) verification = issueRegistrationVerification(user);
    return {
      message: verification && verification.sent ? '新的驗證碼已寄至校務信箱。' : '若帳號尚未驗證，系統會嘗試寄送新的驗證碼。',
      delivery: verification
    };
  });
}

function login(data) {
  var studentNo = requiredText(data.studentNo, '學號').replace(/\s/g, '');
  var password = requiredText(data.password, '密碼');
  var user = findOne('Users', 'StudentNo', studentNo);
  if (!user || user.PasswordHash !== passwordHash(password)) throw appError('INVALID_LOGIN', '學號或密碼不正確。');
  if (boolValue(user.IsDisabled)) throw appError('DISABLED', '此帳號已被停用，請聯絡管理員。');
  if (!boolValue(user.EmailVerified)) {
    var verification = withLock(function() {
      var refreshed = findOne('Users', 'ID', user.ID);
      return refreshed && !boolValue(refreshed.EmailVerified) ? issueRegistrationVerification(refreshed) : null;
    });
    throw appError('EMAIL_NOT_VERIFIED', verification && verification.sent
      ? '請先完成信箱驗證，新的 6 位數驗證碼已寄至校務信箱。'
      : '帳號尚未完成信箱驗證，但驗證信目前無法寄出。請確認 Apps Script 已授權 Gmail、寄送額度尚可使用，然後重新寄送驗證碼。');
  }
  return authResponse(user);
}

function issueRegistrationVerification(user) {
  var code = String(Math.floor(100000 + Math.random() * 900000));
  var expiresAt = new Date(Date.now() + RESET_MINUTES * 60 * 1000);
  updateRow('Users', 'ID', user.ID, {
    EmailVerificationCodeHash: registrationCodeHash(user.StudentNo, code),
    EmailVerificationExpiresAt: expiresAt.toISOString()
  });
  var subject = '【班級訂午餐】請完成信箱驗證';
  var text = user.Name + ' 同學，您好：\n\n你的信箱驗證碼是：' + code + '\n此驗證碼將在 15 分鐘後失效。\n\n若不是你建立帳號，請忽略本信。\n\n班級訂午餐系統';
  try {
    GmailApp.sendEmail(String(user.Email), subject, text, { htmlBody: '<p>' + htmlEscape(user.Name) + ' 同學，您好：</p><p>你的信箱驗證碼是：</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">' + code + '</p><p>此驗證碼將在 <b>15 分鐘</b>後失效。</p><p>若不是你建立帳號，請忽略本信。</p><p>班級訂午餐系統</p>' });
    return { sent: true, expiresAt: expiresAt.toISOString(), message: '驗證碼已寄至 ' + user.Email + '。' };
  } catch (error) {
    console.error('Registration verification email failed for ' + user.Email + ': ' + (error && error.message ? error.message : error));
    return { sent: false, expiresAt: expiresAt.toISOString(), message: '帳號已建立，但驗證信未能寄出。請確認 Apps Script 的 Gmail 授權與寄送額度後，使用「重新寄送驗證碼」。' };
  }
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove('auth_' + token);
  return { loggedOut: true };
}

function requestPasswordReset(data) {
  var studentNo = requiredText(data.studentNo, '學號').replace(/\s/g, '');
  var user = findOne('Users', 'StudentNo', studentNo);
  // 不揭露帳號是否存在，避免帳號枚舉。
  if (!user || boolValue(user.IsDisabled)) return { message: '若此學號已註冊，重設連結會在幾分鐘內寄至校務信箱。' };
  var rawToken = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var expires = new Date(Date.now() + RESET_MINUTES * 60 * 1000);
  withLock(function() {
    appendRow('ResetTokens', { TokenID: tokenHash(rawToken), UserID: user.ID, ExpiresAt: expires.toISOString() });
  });
  var url = buildResetUrl(rawToken);
  var subject = '【班級訂午餐】15 分鐘內有效的密碼重設連結';
  var text = user.Name + ' 同學，您好：\n\n請在 15 分鐘內開啟以下連結重設密碼：\n' + url
    + '\n\n若您沒有提出要求，請忽略本信。\n\n班級訂午餐系統';
  GmailApp.sendEmail(String(user.Email), subject, text, { htmlBody: '<p>' + htmlEscape(user.Name) + ' 同學，您好：</p><p>請在 <b>15 分鐘</b>內點擊下方連結重設密碼：</p><p><a href="' + htmlEscape(url) + '">重設密碼</a></p><p>若您沒有提出要求，請忽略本信。</p><p>班級訂午餐系統</p>' });
  return { message: '若此學號已註冊，重設連結會在幾分鐘內寄至校務信箱。' };
}

function resetPassword(data) {
  var token = requiredText(data.token, '重設 Token');
  var password = requiredText(data.password, '新密碼');
  if (password.length < 8) throw appError('WEAK_PASSWORD', '密碼至少須為 8 個字元。');
  return withLock(function() {
    var row = findOne('ResetTokens', 'TokenID', tokenHash(token));
    if (!row || !dateValue(row.ExpiresAt) || dateValue(row.ExpiresAt) < new Date()) throw appError('RESET_EXPIRED', '此重設連結已失效，請重新申請。');
    updateRow('Users', 'ID', row.UserID, { PasswordHash: passwordHash(password) });
    deleteRowsWhere('ResetTokens', function(item) { return String(item.UserID) === String(row.UserID); });
    invalidateUserSessions(row.UserID);
    return { message: '密碼已更新，請使用新密碼重新登入。' };
  });
}

function authResponse(user) {
  return { token: createSessionToken(user), user: publicUser(user) };
}

function createSessionToken(user) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('auth_' + token, JSON.stringify({ id: user.ID, role: user.Role, authVersion: getAuthVersion(user.ID) }), SESSION_SECONDS);
  return token;
}

function currentUser(token) {
  if (!token) throw appError('UNAUTHORIZED', '登入已失效，請重新登入。');
  var saved = CacheService.getScriptCache().get('auth_' + token);
  if (!saved) throw appError('UNAUTHORIZED', '登入已失效，請重新登入。');
  var claim = JSON.parse(saved);
  var user = findOne('Users', 'ID', claim.id);
  if (!user || boolValue(user.IsDisabled)) throw appError('UNAUTHORIZED', '帳號無法使用，請重新登入。');
  if (String(claim.authVersion || '0') !== String(getAuthVersion(user.ID))) throw appError('UNAUTHORIZED', '登入已失效，請重新登入。');
  return user;
}

function requireAdmin(token) {
  var user = currentUser(token);
  if (String(user.Role) !== 'Admin') throw appError('FORBIDDEN', '此功能僅限管理員使用。');
  return user;
}

function upgradeAdmin(token, data) {
  var user = currentUser(token);
  var code = requiredText(data.authorizationCode, '系統授權碼');
  var expected = getProperty('ADMIN_AUTH_CODE', '');
  if (!expected || code !== expected) throw appError('BAD_ADMIN_CODE', '系統授權碼不正確。');
  updateRow('Users', 'ID', user.ID, { Role: 'Admin' });
  user.Role = 'Admin';
  invalidateUserSessions(user.ID);
  return authResponse(user);
}

// -----------------------------------------------------------------------------
// 學生訂餐、餘額與 QR/PIN
// -----------------------------------------------------------------------------

function getBootstrap(token) {
  var user = currentUser(token);
  return { user: publicUser(user), sessions: buildOpenSessions(user.ID), orders: getUserOrders(user.ID) };
}

function getOpenSessions(token) {
  var user = currentUser(token);
  return { sessions: buildOpenSessions(user.ID), orders: getUserOrders(user.ID) };
}

function buildOpenSessions(userId) {
  var now = new Date();
  var user = findOne('Users', 'ID', userId);
  var classId = user ? String(user.ClassID || '') : '';
  var existing = readRows('Orders').filter(function(order) { return String(order.UserID) === String(userId); });
  var sessions = readRows('Sessions').filter(function(session) {
    if (classId && String(session.ClassID || '') !== classId) return false;
    return (dateValue(session.CutoffTime) && dateValue(session.CutoffTime) > now) || existing.some(function(order) { return String(order.SessionID) === String(session.SessionID); });
  });
  var stores = readRows('Stores');
  var items = readRows('MenuItems');
  var options = readRows('ItemOptions');
  return sessions.sort(function(a, b) {
    var dateDifference = dateValue(a.OrderDate) - dateValue(b.OrderDate);
    return dateDifference || (dateValue(a.CutoffTime) - dateValue(b.CutoffTime));
  }).map(function(session) {
    var menuItems = items.filter(function(item) { return String(item.StoreID) === String(session.StoreID); }).map(function(item) {
      return {
        itemId: item.ItemID,
        name: item.Name,
        basePrice: numberValue(item.BasePrice),
        options: options.filter(function(option) { return String(option.ItemID) === String(item.ItemID); }).map(function(option) {
          return { optionId: option.OptionID, name: option.OptionName, priceAdjustment: numberValue(option.PriceAdjustment) };
        })
      };
    });
    var store = stores.filter(function(s) { return String(s.StoreID) === String(session.StoreID); })[0];
    var order = existing.filter(function(o) { return String(o.SessionID) === String(session.SessionID); })[0];
    return {
      sessionId: session.SessionID, orderDate: isoDate(session.OrderDate), storeId: session.StoreID,
      storeName: store ? store.Name : '未命名店家', cutoffTime: isoDateTime(session.CutoffTime),
      paymentMode: session.PaymentMode, menuItems: menuItems, existingOrder: order ? publicOrder(order) : null
    };
  });
}

function placeOrder(token, data) {
  var user = currentUser(token);
  var sessionId = requiredText(data.sessionId, '訂餐場次');
  var note = String(data.note || '').trim().slice(0, 200);
  return withLock(function() {
    var session = findOne('Sessions', 'SessionID', sessionId);
    if (!session || (user.ClassID && String(session.ClassID || '') !== String(user.ClassID))) throw appError('SESSION_NOT_FOUND', '找不到此訂餐場次。');
    if (dateValue(session.CutoffTime) <= new Date()) throw appError('ORDER_CLOSED', '此場次已超過截止時間。');
    if (findOneByPair('Orders', 'SessionID', sessionId, 'UserID', user.ID)) throw appError('ORDER_EXISTS', '此日期已完成點餐，無法重複送出。');
    var requestedItems = Array.isArray(data.items) ? data.items : (data.itemId ? [{ itemId: data.itemId, optionIds: data.optionIds || [], quantity: data.quantity || 1 }] : []);
    if (!requestedItems.length || requestedItems.length > 20) throw appError('INVALID_ORDER_ITEMS', '請選擇 1–20 個餐點項目。');
    var knownOptions = readRows('ItemOptions');
    var seenItems = new Set();
    var cartItems = requestedItems.map(function(entry) {
      if (!entry || typeof entry !== 'object') throw appError('INVALID_ORDER_ITEMS', '餐點資料不正確。');
      var itemId = requiredText(entry.itemId, '餐點');
      if (seenItems.has(itemId)) throw appError('DUPLICATE_ITEM', '相同餐點請使用數量調整，不可重複加入。');
      seenItems.add(itemId);
      var quantity = Number(entry.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw appError('INVALID_QUANTITY', '每項餐點數量須為 1–99。');
      var item = findOne('MenuItems', 'ItemID', itemId);
      if (!item || String(item.StoreID) !== String(session.StoreID)) throw appError('INVALID_ITEM', '餐點不屬於此場次。');
      var optionIds = Array.isArray(entry.optionIds) ? entry.optionIds.map(String) : [];
      var optionRows = knownOptions.filter(function(option) { return String(option.ItemID) === String(itemId) && optionIds.indexOf(String(option.OptionID)) >= 0; });
      if (optionRows.length !== optionIds.length || new Set(optionIds).size !== optionIds.length) throw appError('INVALID_OPTION', '選項資料不正確，請重新選擇。');
      var unitPrice = numberValue(item.BasePrice) + optionRows.reduce(function(sum, option) { return sum + numberValue(option.PriceAdjustment); }, 0);
      if (unitPrice < 0) throw appError('INVALID_PRICE', '餐點金額不正確。');
      return { itemId: item.ItemID, itemName: item.Name, basePrice: numberValue(item.BasePrice), quantity: quantity, unitPrice: unitPrice, lineTotal: unitPrice * quantity, selectedOptions: optionRows.map(function(option) { return { optionId: option.OptionID, name: option.OptionName, priceAdjustment: numberValue(option.PriceAdjustment) }; }) };
    });
    var total = cartItems.reduce(function(sum, item) { return sum + item.lineTotal; }, 0);
    if (total < 0) throw appError('INVALID_PRICE', '餐點金額不正確。');
    var balance = numberValue(user.WalletBalance);
    var paymentStatus;
    if (String(session.PaymentMode) === 'Stored-value Only') {
      if (balance < total) throw appError('INSUFFICIENT_BALANCE', '此場次僅接受儲值金；目前餘額不足。');
      paymentStatus = 'PaidWallet';
      updateRow('Users', 'ID', user.ID, { WalletBalance: balance - total });
      appendTransaction(user.ID, 'SYSTEM', -total, 'Deduct');
    } else {
      // 混合模式：餘額足夠才扣儲值金；不足時整筆轉為現金未繳，避免部分付款造成對帳不清。
      if (balance >= total) {
        paymentStatus = 'PaidWallet';
        updateRow('Users', 'ID', user.ID, { WalletBalance: balance - total });
        appendTransaction(user.ID, 'SYSTEM', -total, 'Deduct');
      } else {
        paymentStatus = 'UnpaidCash';
      }
    }
    var orderDetail = { version: 2, items: cartItems, outstandingAmount: paymentStatus === 'UnpaidCash' ? total : 0 };
    appendRow('Orders', {
      OrderID: newId(), SessionID: sessionId, UserID: user.ID, TotalPrice: total,
      PaymentStatus: paymentStatus, PickupStatus: 'NotPickedUp', Note: note,
      Options: JSON.stringify(orderDetail), CreatedAt: nowIso()
    });
    var refreshed = findOne('Users', 'ID', user.ID);
    return { order: publicOrder(findLast('Orders')), walletBalance: numberValue(refreshed.WalletBalance) };
  });
}

/** 僅允許本人於截止前，且尚未取餐／現金結清時調整自己的訂單。 */
function updateOwnOrder(token, data) {
  var user = currentUser(token);
  var orderId = requiredText(data.orderId, '訂單');
  var note = String(data.note || '').trim().slice(0, 200);
  return withLock(function() {
    var order = findOne('Orders', 'OrderID', orderId);
    assertOrderCanBeChanged(order, user);
    var session = findOne('Sessions', 'SessionID', order.SessionID);
    if (!session) throw appError('SESSION_NOT_FOUND', '找不到此訂單所屬場次。');
    var cart = buildOrderCart(session, data);
    var payment = reapplyOrderPayment(user, session, order, cart.total);
    var detail = { version: 2, items: cart.items, outstandingAmount: payment.outstandingAmount };
    updateRow('Orders', 'OrderID', orderId, { TotalPrice: cart.total, PaymentStatus: payment.paymentStatus, Note: note, Options: JSON.stringify(detail) });
    return { order: publicOrder(findOne('Orders', 'OrderID', orderId)), walletBalance: payment.walletBalance };
  });
}

/** 刪除截止前的本人訂單；若曾扣過錢包，會自動退回已扣的部分並留下交易紀錄。 */
function deleteOwnOrder(token, data) {
  var user = currentUser(token);
  var orderId = requiredText(data.orderId, '訂單');
  return withLock(function() {
    var order = findOne('Orders', 'OrderID', orderId);
    assertOrderCanBeChanged(order, user);
    var detail = parseOrderDetail(order);
    var refunded = Math.max(0, numberValue(order.TotalPrice) - getOutstandingAmount(order, detail));
    var walletBalance = numberValue(user.WalletBalance) + refunded;
    if (refunded > 0) {
      updateRow('Users', 'ID', user.ID, { WalletBalance: walletBalance });
      appendTransaction(user.ID, 'SYSTEM', refunded, 'TopUp');
    }
    deleteRowsWhere('Orders', function(row) { return String(row.OrderID) === String(orderId); });
    return { deleted: true, orderId: orderId, refunded: refunded, walletBalance: walletBalance };
  });
}

function assertOrderCanBeChanged(order, user) {
  if (!order || String(order.UserID) !== String(user.ID)) throw appError('ORDER_NOT_FOUND', '找不到可修改的訂單。');
  var session = findOne('Sessions', 'SessionID', order.SessionID);
  if (!session || dateValue(session.CutoffTime) <= new Date()) throw appError('ORDER_CLOSED', '此場次已超過截止時間，無法修改訂單。');
  if (String(order.PickupStatus) === 'PickedUp') throw appError('ORDER_PICKED_UP', '訂單已完成取餐，無法修改。');
  if (String(order.PaymentStatus) === 'PaidCash') throw appError('ORDER_CASH_SETTLED', '訂單已以現金結清，請聯絡管理員處理異動。');
}

function buildOrderCart(session, data) {
  var requestedItems = Array.isArray(data.items) ? data.items : (data.itemId ? [{ itemId: data.itemId, optionIds: data.optionIds || [], quantity: data.quantity || 1 }] : []);
  if (!requestedItems.length || requestedItems.length > 20) throw appError('INVALID_ORDER_ITEMS', '請選擇 1–20 個餐點項目。');
  var knownOptions = readRows('ItemOptions');
  var seenItems = new Set();
  var items = requestedItems.map(function(entry) {
    if (!entry || typeof entry !== 'object') throw appError('INVALID_ORDER_ITEMS', '餐點資料不正確。');
    var itemId = requiredText(entry.itemId, '餐點');
    if (seenItems.has(itemId)) throw appError('DUPLICATE_ITEM', '相同餐點請使用數量調整，不可重複加入。');
    seenItems.add(itemId);
    var quantity = Number(entry.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw appError('INVALID_QUANTITY', '每項餐點數量須為 1–99。');
    var item = findOne('MenuItems', 'ItemID', itemId);
    if (!item || String(item.StoreID) !== String(session.StoreID)) throw appError('INVALID_ITEM', '餐點不屬於此場次。');
    var optionIds = Array.isArray(entry.optionIds) ? entry.optionIds.map(String) : [];
    var optionRows = knownOptions.filter(function(option) { return String(option.ItemID) === String(itemId) && optionIds.indexOf(String(option.OptionID)) >= 0; });
    if (optionRows.length !== optionIds.length || new Set(optionIds).size !== optionIds.length) throw appError('INVALID_OPTION', '選項資料不正確，請重新選擇。');
    var unitPrice = numberValue(item.BasePrice) + optionRows.reduce(function(sum, option) { return sum + numberValue(option.PriceAdjustment); }, 0);
    if (unitPrice < 0) throw appError('INVALID_PRICE', '餐點金額不正確。');
    return { itemId: item.ItemID, itemName: item.Name, basePrice: numberValue(item.BasePrice), quantity: quantity, unitPrice: unitPrice, lineTotal: unitPrice * quantity, selectedOptions: optionRows.map(function(option) { return { optionId: option.OptionID, name: option.OptionName, priceAdjustment: numberValue(option.PriceAdjustment) }; }) };
  });
  var total = items.reduce(function(sum, item) { return sum + item.lineTotal; }, 0);
  if (total < 0) throw appError('INVALID_PRICE', '餐點金額不正確。');
  return { items: items, total: total };
}

/** 先將原訂單已支付的金額納回可用額度，再以新總額一次重算，並只記錄錢包淨差額。 */
function reapplyOrderPayment(user, session, order, total) {
  var oldDetail = parseOrderDetail(order);
  var priorPaid = Math.max(0, numberValue(order.TotalPrice) - getOutstandingAmount(order, oldDetail));
  var oldBalance = numberValue(user.WalletBalance);
  var available = oldBalance + priorPaid;
  if (String(session.PaymentMode) === 'Stored-value Only' && available < total) throw appError('INSUFFICIENT_BALANCE', '更新後的訂單金額超過可用儲值金，無法送出。');
  var paidByWallet = String(session.PaymentMode) === 'Stored-value Only' || available >= total;
  var walletBalance = paidByWallet ? available - total : 0;
  var outstandingAmount = paidByWallet ? 0 : Math.max(0, total - available);
  var paymentStatus = paidByWallet ? 'PaidWallet' : (available > 0 ? 'PartiallyPaid' : 'UnpaidCash');
  var delta = walletBalance - oldBalance;
  if (delta !== 0) {
    updateRow('Users', 'ID', user.ID, { WalletBalance: walletBalance });
    appendTransaction(user.ID, 'SYSTEM', delta, delta > 0 ? 'TopUp' : 'Deduct');
  }
  return { walletBalance: walletBalance, outstandingAmount: outstandingAmount, paymentStatus: paymentStatus };
}

function getWalletHistory(token) {
  var user = currentUser(token);
  var transactions = readRows('Transactions').filter(function(t) { return String(t.UserID) === String(user.ID); })
    .sort(function(a, b) { return dateValue(b.Timestamp) - dateValue(a.Timestamp); })
    .map(function(t) { return { amount: numberValue(t.Amount), type: t['Type (TopUp/Deduct)'], timestamp: isoDateTime(t.Timestamp), adminId: t.AdminID }; });
  var cashUnpaid = getUserOrders(user.ID).reduce(function(sum, order) { return sum + numberValue(order.outstandingAmount); }, 0);
  return { user: publicUser(user), transactions: transactions, cashUnpaid: cashUnpaid };
}

function createVerification(token, data) {
  var user = currentUser(token);
  var type = requiredText(data.type, '驗證類型');
  if (['pickup', 'checkout', 'topup'].indexOf(type) < 0) throw appError('INVALID_VERIFICATION_TYPE', '驗證類型不正確。');
  var pin = String(Math.floor(100000 + Math.random() * 900000));
  var expires = new Date(Date.now() + VERIFY_MINUTES * 60 * 1000);
  withLock(function() {
    deleteRowsWhere('Verification', function(v) {
      return String(v.UserID) === String(user.ID) && String(v['Type (pickup/checkout/topup)']) === type;
    });
    appendRow('Verification', { UserID: user.ID, PIN: pin, 'Type (pickup/checkout/topup)': type, ExpiresAt: expires.toISOString() });
  });
  return { payload: { v: 1, uid: user.ID, pin: pin, type: type, exp: expires.toISOString() }, pin: pin, expiresAt: expires.toISOString() };
}

function getUserOrders(userId) {
  var sessions = readRows('Sessions');
  return readRows('Orders').filter(function(order) { return String(order.UserID) === String(userId); })
    .sort(function(a, b) { return dateValue(b.CreatedAt) - dateValue(a.CreatedAt); })
    .map(function(order) {
      var session = sessions.filter(function(s) { return String(s.SessionID) === String(order.SessionID); })[0];
      var publicData = publicOrder(order);
      if (session) { publicData.orderDate = isoDate(session.OrderDate); publicData.sessionId = session.SessionID; }
      return publicData;
    });
}

// -----------------------------------------------------------------------------
// 管理員：儀表板、掃碼核銷、店家與場次管理
// -----------------------------------------------------------------------------

function getAdminDashboard(token, data) {
  var admin = requireAdmin(token);
  var targetDate = String(data.orderDate || todayString());
  var sessions = readRows('Sessions').filter(function(s) { return String(s.ClassID || '') === String(admin.ClassID || '') && isoDate(s.OrderDate) === targetDate; });
  var sessionMap = {};
  sessions.forEach(function(s) { sessionMap[String(s.SessionID)] = s; });
  var users = readRows('Users');
  var orders = readRows('Orders').filter(function(order) { return !!sessionMap[String(order.SessionID)]; });
  var total = orders.reduce(function(sum, order) { return sum + numberValue(order.TotalPrice); }, 0);
  var unpaid = orders.filter(function(order) { return getOutstandingAmount(order, parseOrderDetail(order)) > 0; });
  var pickup = orders.filter(function(order) { return String(order.PickupStatus) === 'PickedUp'; });
  return {
    date: targetDate,
    availableDates: readRows('Sessions').filter(function(s) { return String(s.ClassID || '') === String(admin.ClassID || ''); }).map(function(s) { return isoDate(s.OrderDate); }).filter(unique).sort(),
    stats: { totalMeals: orders.reduce(function(sum, order) { return sum + publicOrder(order).quantity; }, 0), totalReceivable: total, unpaidStudents: new Set(unpaid.map(function(o) { return String(o.UserID); })).size, pickedUp: pickup.reduce(function(sum, order) { return sum + publicOrder(order).quantity; }, 0) },
    sessionSummaries: sessions.sort(function(a, b) { return dateValue(a.CutoffTime) - dateValue(b.CutoffTime); }).map(function(session) { return buildSessionSummary(session, orders); }),
    orders: orders.sort(function(a, b) { return String(a.CreatedAt).localeCompare(String(b.CreatedAt)); }).map(function(order) {
      var u = users.filter(function(user) { return String(user.ID) === String(order.UserID); })[0];
      var s = sessionMap[String(order.SessionID)];
      var item = publicOrder(order);
      item.studentNo = u ? u.StudentNo : '';
      item.studentName = u ? u.Name : '已刪除帳號';
      item.seatNo = u ? u.SeatNo : '';
      item.storeName = storeName(s.StoreID);
      item.orderDate = isoDate(s.OrderDate);
      return item;
    })
  };
}

function buildSessionSummary(session, allOrders) {
  var sessionOrders = allOrders.filter(function(order) { return String(order.SessionID) === String(session.SessionID); });
  var itemMap = {};
  sessionOrders.forEach(function(order) {
    publicOrder(order).items.forEach(function(item) {
      var optionText = (item.selectedOptions || []).map(function(option) { return option.name; }).join('、');
      var key = String(item.itemId) + '|' + optionText;
      if (!itemMap[key]) itemMap[key] = { itemName: item.itemName, selectedOptions: optionText, quantity: 0, orderCount: 0 };
      itemMap[key].quantity += numberValue(item.quantity);
      itemMap[key].orderCount += 1;
    });
  });
  var unpaid = sessionOrders.filter(function(order) { return getOutstandingAmount(order, parseOrderDetail(order)) > 0; });
  return {
    sessionId: session.SessionID, orderDate: isoDate(session.OrderDate), storeName: storeName(session.StoreID), cutoffTime: isoDateTime(session.CutoffTime), paymentMode: session.PaymentMode,
    stats: { orderCount: sessionOrders.length, totalMeals: sessionOrders.reduce(function(sum, order) { return sum + publicOrder(order).quantity; }, 0), totalReceivable: sessionOrders.reduce(function(sum, order) { return sum + numberValue(order.TotalPrice); }, 0), unpaidStudents: new Set(unpaid.map(function(order) { return String(order.UserID); })).size, pickedUp: sessionOrders.filter(function(order) { return String(order.PickupStatus) === 'PickedUp'; }).reduce(function(sum, order) { return sum + publicOrder(order).quantity; }, 0) },
    items: Object.keys(itemMap).map(function(key) { return itemMap[key]; }).sort(function(a, b) { return String(a.itemName).localeCompare(String(b.itemName)); })
  };
}

function adminResolveVerification(token, data) {
  var admin = requireAdmin(token);
  var scanned = data.payload;
  if (typeof scanned === 'string') {
    try { scanned = JSON.parse(scanned); } catch (e) { throw appError('INVALID_QR', 'QR Code 格式不正確。'); }
  }
  if (!scanned || !scanned.uid || !scanned.pin || !scanned.type) throw appError('INVALID_QR', 'QR Code 格式不完整。');
  var mode = requiredText(data.mode, '掃碼模式');
  if (mode !== scanned.type) throw appError('QR_TYPE_MISMATCH', '此 QR Code 與目前掃碼模式不符。');
  var record = findVerification(scanned.uid, scanned.pin, scanned.type);
  if (!record || dateValue(record.ExpiresAt) < new Date()) throw appError('PIN_EXPIRED', 'PIN 已失效，請請學生重新產生。');
  var student = findOne('Users', 'ID', scanned.uid);
  if (!student || String(student.ClassID || '') !== String(admin.ClassID || '') || boolValue(student.IsDisabled)) throw appError('INVALID_STUDENT', '此帳號不可使用。');
  var result = { mode: mode, student: publicUser(student), pin: scanned.pin };
  if (mode === 'pickup') {
    result.orders = todayOrdersForUser(student.ID).filter(function(order) { return order.pickupStatus !== 'PickedUp'; });
  } else if (mode === 'checkout') {
    result.orders = getUserOrders(student.ID).filter(function(order) { return numberValue(order.outstandingAmount) > 0; });
    result.outstandingAmount = result.orders.reduce(function(sum, order) { return sum + numberValue(order.outstandingAmount); }, 0);
  } else {
    result.walletBalance = numberValue(student.WalletBalance);
  }
  return result;
}

function adminConfirmPickup(token, data) {
  var admin = requireAdmin(token);
  var userId = requiredText(data.userId, '學生');
  var orderIds = Array.isArray(data.orderIds) ? data.orderIds.map(String) : [];
  if (!orderIds.length) throw appError('NO_ORDERS', '沒有可確認取餐的訂單。');
  return withLock(function() {
    orderIds.forEach(function(id) {
      var order = findOne('Orders', 'OrderID', id);
      var student = findOne('Users', 'ID', userId);
      var session = order ? findOne('Sessions', 'SessionID', order.SessionID) : null;
      if (!student || String(student.ClassID || '') !== String(admin.ClassID || '') || !order || String(order.UserID) !== String(userId) || !session || String(session.ClassID || '') !== String(admin.ClassID || '') || !isOrderToday(order)) throw appError('INVALID_ORDER', '訂單資料不正確。');
      updateRow('Orders', 'OrderID', id, { PickupStatus: 'PickedUp' });
    });
    consumeVerification(userId, 'pickup');
    return { message: '已確認 ' + orderIds.length + ' 筆取餐。', admin: admin.Name };
  });
}

function adminSettleCash(token, data) {
  var admin = requireAdmin(token);
  var userId = requiredText(data.userId, '學生');
  var orderIds = Array.isArray(data.orderIds) ? data.orderIds.map(String) : [];
  if (!orderIds.length) throw appError('NO_ORDERS', '沒有可結清的現金訂單。');
  return withLock(function() {
    orderIds.forEach(function(id) {
      var order = findOne('Orders', 'OrderID', id);
      var detail = order ? parseOrderDetail(order) : null;
      var student = findOne('Users', 'ID', userId);
      var session = order ? findOne('Sessions', 'SessionID', order.SessionID) : null;
      if (!student || String(student.ClassID || '') !== String(admin.ClassID || '') || !order || String(order.UserID) !== String(userId) || !session || String(session.ClassID || '') !== String(admin.ClassID || '') || getOutstandingAmount(order, detail) <= 0) throw appError('INVALID_ORDER', '訂單已結清或資料不正確。');
      detail.outstandingAmount = 0;
      updateRow('Orders', 'OrderID', id, { PaymentStatus: 'PaidCash', Options: JSON.stringify(detail) });
    });
    consumeVerification(userId, 'checkout');
    return { message: '已標記 ' + orderIds.length + ' 筆現金訂單為已結清。' };
  });
}

function adminTopUp(token, data) {
  var admin = requireAdmin(token);
  var userId = requiredText(data.userId, '學生');
  var amount = numberValue(data.amount);
  if (!isFinite(amount) || amount <= 0 || amount > 100000) throw appError('INVALID_AMOUNT', '儲值金額須介於 1–100000。');
  return withLock(function() {
    var student = findOne('Users', 'ID', userId);
    if (!student || String(student.ClassID || '') !== String(admin.ClassID || '')) throw appError('USER_NOT_FOUND', '找不到學生。');
    var available = numberValue(student.WalletBalance) + amount;
    var appliedToDebt = 0;
    var settledOrders = 0;
    var outstandingOrders = readRows('Orders').filter(function(order) { return String(order.UserID) === String(userId) && getOutstandingAmount(order, parseOrderDetail(order)) > 0; })
      .sort(function(a, b) { return dateValue(a.CreatedAt) - dateValue(b.CreatedAt); });
    outstandingOrders.forEach(function(order) {
      if (available <= 0) return;
      var detail = parseOrderDetail(order);
      var due = getOutstandingAmount(order, detail);
      var paid = Math.min(available, due);
      available -= paid;
      appliedToDebt += paid;
      detail.outstandingAmount = due - paid;
      if (detail.outstandingAmount <= 0) { detail.outstandingAmount = 0; settledOrders += 1; }
      updateRow('Orders', 'OrderID', order.OrderID, { PaymentStatus: detail.outstandingAmount === 0 ? 'PaidWallet' : 'PartiallyPaid', Options: JSON.stringify(detail) });
    });
    var balance = Math.max(0, available);
    updateRow('Users', 'ID', userId, { WalletBalance: balance });
    appendTransaction(userId, admin.ID, amount, 'TopUp');
    if (appliedToDebt > 0) appendTransaction(userId, admin.ID, -appliedToDebt, 'Deduct');
    consumeVerification(userId, 'topup');
    var remainingDebt = outstandingOrders.reduce(function(sum, order) { var refreshed = findOne('Orders', 'OrderID', order.OrderID); return sum + getOutstandingAmount(refreshed, parseOrderDetail(refreshed)); }, 0);
    return { message: '已為 ' + student.Name + ' 儲值 ' + amount + ' 元。', walletBalance: balance, appliedToDebt: appliedToDebt, remainingDebt: remainingDebt, settledOrders: settledOrders };
  });
}

function adminCatalog(token) {
  var admin = requireAdmin(token);
  var stores = readRows('Stores').filter(function(s) { return String(s.ClassID || '') === String(admin.ClassID || ''); });
  var storeIds = stores.map(function(s) { return String(s.StoreID); });
  var items = readRows('MenuItems').filter(function(i) { return storeIds.indexOf(String(i.StoreID)) >= 0; });
  var itemIds = items.map(function(i) { return String(i.ItemID); });
  return {
    stores: stores.map(function(s) { return { storeId: s.StoreID, name: s.Name }; }),
    items: items.map(function(i) { return { itemId: i.ItemID, storeId: i.StoreID, name: i.Name, basePrice: numberValue(i.BasePrice) }; }),
    options: readRows('ItemOptions').filter(function(o) { return itemIds.indexOf(String(o.ItemID)) >= 0; }).map(function(o) { return { optionId: o.OptionID, itemId: o.ItemID, name: o.OptionName, priceAdjustment: numberValue(o.PriceAdjustment) }; }),
    sessions: readRows('Sessions').filter(function(s) { return String(s.ClassID || '') === String(admin.ClassID || ''); }).map(function(s) { return { sessionId: s.SessionID, orderDate: isoDate(s.OrderDate), storeId: s.StoreID, cutoffTime: isoDateTime(s.CutoffTime), paymentMode: s.PaymentMode }; })
  };
}

function adminSaveStore(token, data) {
  var admin = requireAdmin(token);
  var name = requiredText(data.name, '店家名稱').slice(0, 60);
  return withLock(function() {
    var id = data.storeId ? String(data.storeId) : newId();
    var current = findOne('Stores', 'StoreID', id);
    if (current) {
      if (String(current.ClassID || '') !== String(admin.ClassID || '')) throw appError('STORE_NOT_FOUND', '店家不存在。');
      updateRow('Stores', 'StoreID', id, { Name: name });
    } else appendRow('Stores', { StoreID: id, ClassID: admin.ClassID, Name: name });
    return { storeId: id, name: name };
  });
}

function adminDeleteStore(token, data) {
  var admin = requireAdmin(token);
  var storeId = requiredText(data.storeId, '店家');
  return withLock(function() {
    var store = findOne('Stores', 'StoreID', storeId);
    if (!store || String(store.ClassID || '') !== String(admin.ClassID || '')) throw appError('STORE_NOT_FOUND', '店家不存在。');
    var sessionIds = readRows('Sessions').filter(function(s) { return String(s.StoreID) === String(storeId); }).map(function(s) { return String(s.SessionID); });
    var hasOrders = readRows('Orders').some(function(order) { return sessionIds.indexOf(String(order.SessionID)) >= 0; });
    if (hasOrders) throw appError('STORE_HAS_ORDER_HISTORY', '此店家已有訂單紀錄，為保留帳務不可刪除。請改為停止建立新場次。');
    var itemIds = readRows('MenuItems').filter(function(item) { return String(item.StoreID) === String(storeId); }).map(function(item) { return String(item.ItemID); });
    deleteRowsWhere('ItemOptions', function(option) { return itemIds.indexOf(String(option.ItemID)) >= 0; });
    deleteRowsWhere('MenuItems', function(item) { return String(item.StoreID) === String(storeId); });
    deleteRowsWhere('Sessions', function(session) { return String(session.StoreID) === String(storeId); });
    deleteRowsWhere('Stores', function(store) { return String(store.StoreID) === String(storeId); });
    return { deleted: true, storeId: storeId };
  });
}

function adminSaveMenuItem(token, data) {
  var admin = requireAdmin(token);
  var storeId = requiredText(data.storeId, '店家');
  var name = requiredText(data.name, '餐點名稱').slice(0, 80);
  var price = numberValue(data.basePrice);
  if (price < 0 || price > 10000) throw appError('INVALID_PRICE', '餐點價格不正確。');
  var ownedStore = findOne('Stores', 'StoreID', storeId);
  if (!ownedStore || String(ownedStore.ClassID || '') !== String(admin.ClassID || '')) throw appError('STORE_NOT_FOUND', '店家不存在。');
  return withLock(function() {
    var id = data.itemId ? String(data.itemId) : newId();
    var current = findOne('MenuItems', 'ItemID', id);
    if (current && String(current.StoreID || '') !== String(storeId)) throw appError('ITEM_NOT_FOUND', '餐點不存在。');
    if (current) updateRow('MenuItems', 'ItemID', id, { StoreID: storeId, Name: name, BasePrice: price });
    else appendRow('MenuItems', { ItemID: id, StoreID: storeId, Name: name, BasePrice: price });
    return { itemId: id, storeId: storeId, name: name, basePrice: price };
  });
}

function adminDeleteMenuItem(token, data) {
  var admin = requireAdmin(token);
  var itemId = requiredText(data.itemId, '餐點');
  return withLock(function() {
    var item = findOne('MenuItems', 'ItemID', itemId);
    var itemStore = item ? findOne('Stores', 'StoreID', item.StoreID) : null;
    if (!item || !itemStore || String(itemStore.ClassID || '') !== String(admin.ClassID || '')) throw appError('ITEM_NOT_FOUND', '餐點不存在。');
    deleteRowsWhere('ItemOptions', function(option) { return String(option.ItemID) === String(itemId); });
    deleteRowsWhere('MenuItems', function(item) { return String(item.ItemID) === String(itemId); });
    return { deleted: true, itemId: itemId };
  });
}

function adminSaveItemOption(token, data) {
  var admin = requireAdmin(token);
  var itemId = requiredText(data.itemId, '餐點');
  var name = requiredText(data.name, '選項名稱').slice(0, 80);
  var adjustment = numberValue(data.priceAdjustment);
  if (adjustment < -10000 || adjustment > 10000) throw appError('INVALID_PRICE', '選項價格不正確。');
  var item = findOne('MenuItems', 'ItemID', itemId);
  var itemStore = item ? findOne('Stores', 'StoreID', item.StoreID) : null;
  if (!item || !itemStore || String(itemStore.ClassID || '') !== String(admin.ClassID || '')) throw appError('ITEM_NOT_FOUND', '餐點不存在。');
  return withLock(function() {
    var id = data.optionId ? String(data.optionId) : newId();
    var current = findOne('ItemOptions', 'OptionID', id);
    if (current && String(current.ItemID || '') !== String(itemId)) throw appError('OPTION_NOT_FOUND', '客製選項不存在。');
    if (current) updateRow('ItemOptions', 'OptionID', id, { ItemID: itemId, OptionName: name, PriceAdjustment: adjustment });
    else appendRow('ItemOptions', { OptionID: id, ItemID: itemId, OptionName: name, PriceAdjustment: adjustment });
    return { optionId: id, itemId: itemId, name: name, priceAdjustment: adjustment };
  });
}

function adminDeleteItemOption(token, data) {
  var admin = requireAdmin(token);
  var optionId = requiredText(data.optionId, '客製選項');
  return withLock(function() {
    var option = findOne('ItemOptions', 'OptionID', optionId);
    var optionItem = option ? findOne('MenuItems', 'ItemID', option.ItemID) : null;
    var optionStore = optionItem ? findOne('Stores', 'StoreID', optionItem.StoreID) : null;
    if (!option || !optionStore || String(optionStore.ClassID || '') !== String(admin.ClassID || '')) throw appError('OPTION_NOT_FOUND', '客製選項不存在。');
    deleteRowsWhere('ItemOptions', function(option) { return String(option.OptionID) === String(optionId); });
    return { deleted: true, optionId: optionId };
  });
}

function adminSaveSession(token, data) {
  var admin = requireAdmin(token);
  var orderDate = requiredText(data.orderDate, '訂餐日期');
  var storeId = requiredText(data.storeId, '店家');
  var cutoffTime = requiredText(data.cutoffTime, '截止時間');
  var paymentMode = requiredText(data.paymentMode, '支付模式');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate) || !dateValue(cutoffTime)) throw appError('INVALID_DATE', '日期或截止時間格式不正確。');
  if (dateValue(cutoffTime) <= new Date()) throw appError('INVALID_CUTOFF', '截止時間必須在現在之後。');
  if (['Hybrid', 'Stored-value Only'].indexOf(paymentMode) < 0) throw appError('INVALID_PAYMENT_MODE', '支付模式不正確。');
  var ownedStore = findOne('Stores', 'StoreID', storeId);
  if (!ownedStore || String(ownedStore.ClassID || '') !== String(admin.ClassID || '')) throw appError('STORE_NOT_FOUND', '店家不存在。');
  var saved = withLock(function() {
    var id = data.sessionId ? String(data.sessionId) : newId();
    var current = findOne('Sessions', 'SessionID', id);
    var fields = { ClassID: admin.ClassID, OrderDate: orderDate, StoreID: storeId, CutoffTime: new Date(cutoffTime).toISOString(), PaymentMode: paymentMode };
    if (current) {
      if (String(current.ClassID || '') !== String(admin.ClassID || '')) throw appError('SESSION_NOT_FOUND', '找不到此訂餐場次。');
      updateRow('Sessions', 'SessionID', id, fields);
    } else { fields.SessionID = id; appendRow('Sessions', fields); }
    return { sessionId: id, classId: admin.ClassID, orderDate: orderDate, storeId: storeId, cutoffTime: new Date(cutoffTime).toISOString(), paymentMode: paymentMode, created: !current };
  });
  if (saved.created) {
    saved.notification = notifySessionCreated(saved);
  }
  return saved;
}

/** 僅調整尚開放場次的截止時間，避免編輯日期／店家而影響已產生訂單。 */
function adminUpdateSessionCutoff(token, data) {
  var admin = requireAdmin(token);
  var sessionId = requiredText(data.sessionId, '訂餐場次');
  var cutoffTime = requiredText(data.cutoffTime, '截止時間');
  var cutoff = dateValue(cutoffTime);
  if (!cutoff || cutoff <= new Date()) throw appError('INVALID_CUTOFF', '新的截止時間必須在現在之後；若要立即停止接單，請使用「提前結束」。');
  return withLock(function() {
    var session = findOne('Sessions', 'SessionID', sessionId);
    if (!session || String(session.ClassID || '') !== String(admin.ClassID || '')) throw appError('SESSION_NOT_FOUND', '找不到此訂餐場次。');
    updateRow('Sessions', 'SessionID', sessionId, { CutoffTime: cutoff.toISOString() });
    return { sessionId: sessionId, cutoffTime: cutoff.toISOString(), closed: false };
  });
}

/** 將截止時間設為目前時刻，立即阻止新的訂餐但完整保留既有訂單及帳務。 */
function adminCloseSession(token, data) {
  var admin = requireAdmin(token);
  var sessionId = requiredText(data.sessionId, '訂餐場次');
  return withLock(function() {
    var session = findOne('Sessions', 'SessionID', sessionId);
    if (!session || String(session.ClassID || '') !== String(admin.ClassID || '')) throw appError('SESSION_NOT_FOUND', '找不到此訂餐場次。');
    var closedAt = nowIso();
    updateRow('Sessions', 'SessionID', sessionId, { CutoffTime: closedAt });
    return { sessionId: sessionId, cutoffTime: closedAt, closed: true };
  });
}

/** 僅允許刪除尚未有訂單的場次，避免遺失訂餐、付款與核銷紀錄。 */
function adminDeleteSession(token, data) {
  var admin = requireAdmin(token);
  var sessionId = requiredText(data.sessionId, '訂餐場次');
  return withLock(function() {
    var session = findOne('Sessions', 'SessionID', sessionId);
    if (!session || String(session.ClassID || '') !== String(admin.ClassID || '')) throw appError('SESSION_NOT_FOUND', '找不到此訂餐場次。');
    if (readRows('Orders').some(function(order) { return String(order.SessionID) === String(sessionId); })) {
      throw appError('SESSION_HAS_ORDER_HISTORY', '此場次已有訂單紀錄，為保留帳務不可刪除；可改用「提前結束」停止接單。');
    }
    deleteRowsWhere('Sessions', function(session) { return String(session.SessionID) === String(sessionId); });
    return { deleted: true, sessionId: sessionId };
  });
}

/** 建立新場次後，通知所有未停用的帳號；個別寄送失敗不影響場次建立。 */
function notifySessionCreated(session) {
  var store = findOne('Stores', 'StoreID', session.storeId);
  var storeNameText = store ? String(store.Name) : '未命名店家';
  var users = readRows('Users').filter(function(user) { return !boolValue(user.IsDisabled) && String(user.Email || '').indexOf('@') > 0 && String(user.ClassID || '') === String(session.classId || ''); });
  var sent = 0;
  var failed = 0;
  var subject = '【班級訂午餐】開放新訂餐場次：' + formatDate(session.orderDate);
  users.forEach(function(user) {
    var body = String(user.Name || '同學') + '，您好：\n\n'
      + '已開放新的訂餐場次。\n'
      + '日期：' + formatDate(session.orderDate) + '\n'
      + '店家：' + storeNameText + '\n'
      + '截止時間：' + formatDateTime(session.cutoffTime) + '\n'
      + '支付模式：' + (String(session.paymentMode) === 'Stored-value Only' ? '純儲值模式' : '混合模式') + '\n\n'
      + '請於截止前登入班級訂午餐系統完成選餐。';
    try {
      GmailApp.sendEmail(String(user.Email), subject, body);
      sent++;
    } catch (error) {
      failed++;
      console.error('Session notification failed for ' + user.Email + ': ' + (error && error.message ? error.message : error));
    }
  });
  return { attempted: users.length, sent: sent, failed: failed };
}

function developerGenerateClassAdminCode(className) {
  var name = requiredText(className, '班級名稱').slice(0, 80);
  var raw = 'ADM-' + Utilities.getUuid().replace(/-/g, '').slice(0, 20).toUpperCase();
  appendRow('DeveloperCodes', { CodeID: newId(), CodeHash: inviteCodeHash(raw), ClassName: name, IsUsed: false, CreatedAt: nowIso(), UsedAt: '', UsedBy: '' });
  return { className: name, code: raw, message: '請只將此代碼交給該班級管理者；代碼僅能使用一次。' };
}

function developerRevokeClassAdminCode(data) {
  var developerKey = requiredText(data.developerKey, '開發者授權碼');
  var configuredKey = String(getProperty('DEVELOPER_MASTER_KEY', ''));
  if (!configuredKey || developerKey !== configuredKey) throw appError('DEVELOPER_UNAUTHORIZED', '開發者授權碼不正確。');
  var id = requiredText(data.codeId, '開發者代碼');
  var row = findOne('DeveloperCodes', 'CodeID', id);
  if (!row) throw appError('CODE_NOT_FOUND', '開發者代碼不存在。');
  if (boolValue(row.IsUsed)) throw appError('CODE_ALREADY_USED', '已使用的代碼不可撤銷。');
  updateRow('DeveloperCodes', 'CodeID', id, { IsUsed: true, UsedAt: nowIso(), UsedBy: 'developer-revoked' });
  return { revoked: true, codeId: id };
}

function developerMasterKeyIsValid(key) {
  var configuredKey = String(getProperty('DEVELOPER_MASTER_KEY', ''));
  return !!configuredKey && String(key || '') === configuredKey;
}
function developerRegister(data) {
  var username = requiredText(data.username, '開發者帳號').trim();
  var email = requiredText(data.email, '電子郵件').trim().toLowerCase();
  var password = requiredText(data.password, '密碼');
  var activationKey = requiredText(data.activationKey, '開發者金鑰');
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) throw appError('INVALID_DEVELOPER_USERNAME', '開發者帳號須為 3–40 個英數字、句點、底線或連字號。');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw appError('INVALID_EMAIL', '電子郵件格式不正確。');
  if (password.length < 8) throw appError('WEAK_PASSWORD', '密碼至少須為 8 個字元。');
  if (!developerMasterKeyIsValid(activationKey)) throw appError('DEVELOPER_UNAUTHORIZED', '開發者金鑰不正確或尚未設定。');
  return withLock(function() {
    if (readRows('DeveloperAccounts').some(function(account) { return String(account.Username).toLowerCase() === username.toLowerCase(); })) throw appError('DUPLICATE_DEVELOPER', '此開發者帳號已存在。');
    if (readRows('DeveloperAccounts').some(function(account) { return String(account.Email).toLowerCase() === email; })) throw appError('DUPLICATE_DEVELOPER', '此電子郵件已註冊開發者帳號。');
    var id = newId();
    appendRow('DeveloperAccounts', { DeveloperID: id, Username: username, Email: email, PasswordHash: passwordHash(password), IsActive: true, CreatedAt: nowIso(), LastLoginAt: '' });
    return { registered: true, developer: publicDeveloper(findOne('DeveloperAccounts', 'DeveloperID', id)), message: '開發者帳號已開通，請使用新帳號登入。' };
  });
}
function developerLogin(data) {
  var username = requiredText(data.username, '開發者帳號').trim();
  var password = requiredText(data.password, '密碼');
  var account = readRows('DeveloperAccounts').filter(function(item) { return String(item.Username).toLowerCase() === username.toLowerCase(); })[0];
  if (!account || account.PasswordHash !== passwordHash(password)) throw appError('INVALID_DEVELOPER_LOGIN', '開發者帳號或密碼不正確。');
  if (!boolValue(account.IsActive)) throw appError('DEVELOPER_DISABLED', '此開發者帳號已停用。');
  updateRow('DeveloperAccounts', 'DeveloperID', account.DeveloperID, { LastLoginAt: nowIso() });
  account.LastLoginAt = nowIso();
  return { token: createDeveloperSessionToken(account), developer: publicDeveloper(account) };
}
function developerLogout(token) {
  if (token) CacheService.getScriptCache().remove('developer_' + token);
  return { loggedOut: true };
}
function createDeveloperSessionToken(account) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('developer_' + token, JSON.stringify({ id: account.DeveloperID }), SESSION_SECONDS);
  return token;
}
function requireDeveloper(token) {
  if (!token) throw appError('DEVELOPER_UNAUTHORIZED', '請先登入開發者帳號。');
  var saved = CacheService.getScriptCache().get('developer_' + token);
  if (!saved) throw appError('DEVELOPER_UNAUTHORIZED', '開發者登入已失效，請重新登入。');
  var claim = JSON.parse(saved);
  var account = findOne('DeveloperAccounts', 'DeveloperID', claim.id);
  if (!account || !boolValue(account.IsActive)) throw appError('DEVELOPER_UNAUTHORIZED', '開發者帳號無法使用，請重新登入。');
  return account;
}
function publicDeveloper(account) {
  return { developerId: account.DeveloperID, username: account.Username, email: account.Email, isActive: boolValue(account.IsActive), createdAt: isoDateTime(account.CreatedAt), lastLoginAt: isoDateTime(account.LastLoginAt) };
}
function developerListClassAdminCodes(token) {
  requireDeveloper(token);
  return readRows('DeveloperCodes').map(function(code) {
    return { codeId: code.CodeID, className: code.ClassName, isUsed: boolValue(code.IsUsed), createdAt: isoDateTime(code.CreatedAt), usedAt: isoDateTime(code.UsedAt), usedBy: String(code.UsedBy || '') };
  }).sort(function(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
}
function developerIssueClassAdminCode(token, data) {
  requireDeveloper(token);
  return developerGenerateClassAdminCode(requiredText(data.className, '班級名稱'));
}
function developerRevokeClassAdminCodeForSession(token, data) {
  requireDeveloper(token);
  var id = requiredText(data.codeId, '開發者代碼');
  var row = findOne('DeveloperCodes', 'CodeID', id);
  if (!row) throw appError('CODE_NOT_FOUND', '開發者代碼不存在。');
  if (boolValue(row.IsUsed)) throw appError('CODE_ALREADY_USED', '已使用的代碼不可撤銷。');
  updateRow('DeveloperCodes', 'CodeID', id, { IsUsed: true, UsedAt: nowIso(), UsedBy: 'developer-revoked' });
  return { revoked: true, codeId: id };
}
function developerListUsers(token) {
  requireDeveloper(token);
  return readRows('Users').map(function(user) { return publicUser(user); }).sort(function(a, b) { return String(a.className).localeCompare(String(b.className)) || String(a.studentNo).localeCompare(String(b.studentNo)); });
}
function developerGetUserDetails(token, data) {
  requireDeveloper(token);
  var userId = requiredText(data.userId, '帳號');
  var user = findOne('Users', 'ID', userId);
  if (!user) throw appError('USER_NOT_FOUND', '找不到帳號。');
  var result = publicUser(user);
  result.orders = readRows('Orders').filter(function(order) { return String(order.UserID) === String(userId); }).map(function(order) { return publicOrder(order); });
  result.transactions = readRows('Transactions').filter(function(transaction) { return String(transaction.UserID) === String(userId); }).map(function(transaction) {
    return { transId: transaction.TransID, adminId: transaction.AdminID, amount: numberValue(transaction.Amount), type: transaction['Type (TopUp/Deduct)'], timestamp: isoDateTime(transaction.Timestamp) };
  });
  return result;
}
function developerSetUserDisabled(token, data) {
  requireDeveloper(token);
  var userId = requiredText(data.userId, '帳號');
  var disabled = !!data.isDisabled;
  return withLock(function() {
    var target = findOne('Users', 'ID', userId);
    if (!target) throw appError('USER_NOT_FOUND', '找不到帳號。');
    updateRow('Users', 'ID', userId, { IsDisabled: disabled });
    invalidateUserSessions(userId);
    return { userId: userId, isDisabled: disabled };
  });
}
function developerDeleteUser(token, data) {
  requireDeveloper(token);
  var userId = requiredText(data.userId, '帳號');
  return withLock(function() {
    var user = findOne('Users', 'ID', userId);
    if (!user) throw appError('USER_NOT_FOUND', '找不到帳號。');
    var retainedOrderCount = readRows('Orders').filter(function(order) { return String(order.UserID) === String(userId); }).length;
    var retainedTransactionCount = readRows('Transactions').filter(function(transaction) { return String(transaction.UserID) === String(userId); }).length;
    deleteRowsWhere('Verification', function(record) { return String(record.UserID) === String(userId); });
    deleteRowsWhere('ResetTokens', function(record) { return String(record.UserID) === String(userId); });
    deleteRowsWhere('Users', function(record) { return String(record.ID) === String(userId); });
    invalidateUserSessions(userId);
    return { deleted: true, userId: userId, retainedOrderCount: retainedOrderCount, retainedTransactionCount: retainedTransactionCount };
  });
}
function adminListInviteCodes(token) {
  var admin = requireAdmin(token);
  return readRows('InviteCodes').filter(function(code) { return String(code.ClassID) === String(admin.ClassID); }).map(function(code) {
    return { inviteCodeId: code.InviteCodeID, label: code.Label, isDisabled: boolValue(code.IsDisabled), createdAt: isoDateTime(code.CreatedAt) };
  });
}

function adminCreateInviteCode(token, data) {
  var admin = requireAdmin(token);
  var label = String(data.label || '班級邀請碼').trim().slice(0, 60);
  var raw = 'INV-' + Utilities.getUuid().replace(/-/g, '').slice(0, 16).toUpperCase();
  appendRow('InviteCodes', { InviteCodeID: newId(), ClassID: admin.ClassID, CodeHash: inviteCodeHash(raw), Label: label || '班級邀請碼', IsDisabled: false, CreatedAt: nowIso(), CreatedBy: admin.ID });
  return { code: raw, label: label || '班級邀請碼' };
}

function adminDisableInviteCode(token, data) {
  var admin = requireAdmin(token);
  var id = requiredText(data.inviteCodeId, '邀請碼');
  var code = findOne('InviteCodes', 'InviteCodeID', id);
  if (!code || String(code.ClassID) !== String(admin.ClassID)) throw appError('INVITE_NOT_FOUND', '邀請碼不存在。');
  updateRow('InviteCodes', 'InviteCodeID', id, { IsDisabled: true });
  return { inviteCodeId: id, isDisabled: true };
}

function adminListUsers(token) {
  var admin = requireAdmin(token);
  return readRows('Users').filter(function(user) { return String(user.ClassID || '') === String(admin.ClassID || ''); }).map(function(user) { return publicUser(user); }).sort(function(a, b) { return String(a.studentNo).localeCompare(String(b.studentNo)); });
}

function adminSetUserDisabled(token, data) {
  var admin = requireAdmin(token);
  var userId = requiredText(data.userId, '帳號');
  if (String(userId) === String(admin.ID)) throw appError('SELF_DISABLE', '不可停用目前登入的管理員帳號。');
  var disabled = !!data.isDisabled;
  return withLock(function() {
    var target = findOne('Users', 'ID', userId);
    if (!target || String(target.ClassID || '') !== String(admin.ClassID || '')) throw appError('USER_NOT_FOUND', '找不到帳號。');
    updateRow('Users', 'ID', userId, { IsDisabled: disabled });
    invalidateUserSessions(userId);
    return { userId: userId, isDisabled: disabled };
  });
}

/** 刪除帳號個資與登入憑證，但保留訂單和交易列作為帳務稽核紀錄。 */
function adminDeleteUser(token, data) {
  var admin = requireAdmin(token);
  var userId = requiredText(data.userId, '帳號');
  if (String(userId) === String(admin.ID)) throw appError('SELF_DELETE', '不可刪除目前登入的管理員帳號。');
  return withLock(function() {
    var user = findOne('Users', 'ID', userId);
    if (!user || String(user.ClassID || '') !== String(admin.ClassID || '')) throw appError('USER_NOT_FOUND', '找不到帳號。');
    if (String(user.Role) === 'Admin') throw appError('ADMIN_DELETE_FORBIDDEN', '為避免失去管理權限，不可由此刪除其他管理員帳號。');
    var retainedOrderCount = readRows('Orders').filter(function(order) { return String(order.UserID) === String(userId); }).length;
    var retainedTransactionCount = readRows('Transactions').filter(function(transaction) { return String(transaction.UserID) === String(userId); }).length;
    deleteRowsWhere('Verification', function(record) { return String(record.UserID) === String(userId); });
    deleteRowsWhere('ResetTokens', function(record) { return String(record.UserID) === String(userId); });
    deleteRowsWhere('Users', function(record) { return String(record.ID) === String(userId); });
    invalidateUserSessions(userId);
    return { deleted: true, userId: userId, retainedOrderCount: retainedOrderCount, retainedTransactionCount: retainedTransactionCount };
  });
}

function classForAdmin(token) {
  var admin = requireAdmin(token);
  var row = findOne('Classes', 'ClassID', admin.ClassID);
  if (!row || boolValue(row.IsDisabled)) throw appError('CLASS_DISABLED', '此班級目前無法使用。');
  return { admin: admin, classRow: row };
}

function adminGetSettings(token) {
  var scope = classForAdmin(token);
  return { classId: scope.classRow.ClassID, className: scope.classRow.ClassName, emailDomain: String(scope.classRow.EmailDomain || '') };
}

/** 不寄送信件，只檢查目前 Apps Script 執行身分是否能使用 Gmail 服務及其當日剩餘額度。 */
function adminGetEmailDiagnostics(token) {
  requireAdmin(token);
  var diagnostics = {
    gmailAuthorized: false,
    remainingDailyQuota: null,
    emailDomain: getClassEmailDomain(requireAdmin(token).ClassID),
    message: ''
  };
  try {
    GmailApp.getAliases();
    diagnostics.gmailAuthorized = true;
  } catch (error) {
    diagnostics.message = 'Gmail 尚未授權或目前帳戶無法使用 GmailApp：' + (error && error.message ? error.message : error);
    return diagnostics;
  }
  try {
    diagnostics.remainingDailyQuota = MailApp.getRemainingDailyQuota();
  } catch (error) {
    diagnostics.message = 'Gmail 已授權，但無法讀取每日寄送額度：' + (error && error.message ? error.message : error);
    return diagnostics;
  }
  diagnostics.message = diagnostics.remainingDailyQuota > 0
    ? 'Gmail 已授權，目前預估尚可寄送 ' + diagnostics.remainingDailyQuota + ' 封郵件。'
    : 'Gmail 已授權，但今日寄送額度已用盡；請於額度重置後再重寄驗證碼。';
  return diagnostics;
}

function getClassEmailDomain(classId) {
  var row = findOne('Classes', 'ClassID', classId);
  return row ? String(row.EmailDomain || '') : '';
}

function adminSaveSettings(token, data) {
  var scope = classForAdmin(token);
  var domain = String(data.emailDomain || '').trim().toLowerCase();
  if (domain && !/^@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(domain)) throw appError('INVALID_DOMAIN', 'Email 後綴格式應如 @class.edu.tw。');
  updateRow('Classes', 'ClassID', scope.classRow.ClassID, { EmailDomain: domain });
  return adminGetSettings(token);
}

function developerGetSettings(token) {
  requireDeveloper(token);
  return { hasAuthorizationCode: !!getProperty('ADMIN_AUTH_CODE', ''), hasDeveloperMasterKey: !!getProperty('DEVELOPER_MASTER_KEY', ''), emailDomainScope: 'class' };
}

function developerSaveSettings(token, data) {
  requireDeveloper(token);
  if (data.newAuthorizationCode !== undefined && String(data.newAuthorizationCode || '') !== '') {
    if (String(data.newAuthorizationCode).length < 8) throw appError('WEAK_ADMIN_CODE', '系統授權碼至少為 8 個字元。');
    PropertiesService.getScriptProperties().setProperty('ADMIN_AUTH_CODE', String(data.newAuthorizationCode));
  }
  return developerGetSettings(token);
}

// -----------------------------------------------------------------------------
// 表格、資料與安全性輔助函式
// -----------------------------------------------------------------------------

function spreadsheet() {
  var id = getProperty('SPREADSHEET_ID', '');
  if (!id) {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
    throw appError('NOT_CONFIGURED', '系統尚未設定 SPREADSHEET_ID。');
  }
  return SpreadsheetApp.openById(id);
}

function sheet(name) {
  var sh = spreadsheet().getSheetByName(name);
  if (!sh) throw appError('SHEET_MISSING', '找不到工作表：' + name + '。請先執行 setupSystem()。');
  return sh;
}

function readRows(name) {
  var sh = sheet(name);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  return values.slice(1).filter(function(row) { return row.some(function(value) { return value !== ''; }); }).map(function(row, index) {
    var obj = { _row: index + 2 };
    headers.forEach(function(header, i) { obj[header] = row[i]; });
    return obj;
  });
}

function appendRow(name, fields) {
  var headers = SHEETS[name];
  sheet(name).appendRow(headers.map(function(header) { return fields[header] === undefined ? '' : fields[header]; }));
}

function findOne(name, column, value) {
  return readRows(name).filter(function(row) { return String(row[column]) === String(value); })[0] || null;
}

function findOneByPair(name, key1, value1, key2, value2) {
  return readRows(name).filter(function(row) { return String(row[key1]) === String(value1) && String(row[key2]) === String(value2); })[0] || null;
}

function findLast(name) {
  var rows = readRows(name);
  return rows[rows.length - 1];
}

function updateRow(name, key, value, fields) {
  var row = findOne(name, key, value);
  if (!row) throw appError('ROW_NOT_FOUND', '找不到要更新的資料。');
  var headers = SHEETS[name];
  Object.keys(fields).forEach(function(field) {
    var col = headers.indexOf(field);
    if (col < 0) throw new Error('未知欄位：' + field);
    sheet(name).getRange(row._row, col + 1).setValue(fields[field]);
  });
}

function deleteRowsWhere(name, predicate) {
  var rows = readRows(name).filter(predicate).sort(function(a, b) { return b._row - a._row; });
  rows.forEach(function(row) { sheet(name).deleteRow(row._row); });
}

function appendTransaction(userId, adminId, amount, type) {
  appendRow('Transactions', { TransID: newId(), UserID: userId, AdminID: adminId, Amount: amount, 'Type (TopUp/Deduct)': type, Timestamp: nowIso() });
}

function findVerification(userId, pin, type) {
  return readRows('Verification').filter(function(v) {
    return String(v.UserID) === String(userId) && String(v.PIN) === String(pin) && String(v['Type (pickup/checkout/topup)']) === String(type);
  })[0] || null;
}

function consumeVerification(userId, type) {
  deleteRowsWhere('Verification', function(v) { return String(v.UserID) === String(userId) && String(v['Type (pickup/checkout/topup)']) === String(type); });
}

function invalidateUserSessions(userId) {
  var props = PropertiesService.getScriptProperties();
  var key = 'authver_' + String(userId);
  var next = Number(props.getProperty(key) || '0') + 1;
  props.setProperty(key, String(next));
  return next;
}

function getAuthVersion(userId) {
  return PropertiesService.getScriptProperties().getProperty('authver_' + String(userId)) || '0';
}

function publicUser(user) {
  var classRow = user.ClassID ? findOne('Classes', 'ClassID', user.ClassID) : null;
  return { id: user.ID, studentNo: user.StudentNo, email: user.Email, name: user.Name, seatNo: user.SeatNo, role: user.Role, classId: user.ClassID || '', className: classRow ? classRow.ClassName : '', walletBalance: numberValue(user.WalletBalance), isDisabled: boolValue(user.IsDisabled), emailVerified: boolValue(user.EmailVerified) };
}

function publicOrder(order) {
  var detail = parseOrderDetail(order);
  var items = normalizeOrderItems(detail);
  var quantity = items.reduce(function(sum, item) { return sum + numberValue(item.quantity || 1); }, 0);
  return {
    orderId: order.OrderID, sessionId: order.SessionID, totalPrice: numberValue(order.TotalPrice),
    paymentStatus: String(order.PaymentStatus), pickupStatus: String(order.PickupStatus), note: String(order.Note || ''),
    itemName: items.map(function(item) { return (numberValue(item.quantity || 1) > 1 ? numberValue(item.quantity || 1) + '×' : '') + (item.itemName || '未命名餐點'); }).join('、'),
    basePrice: items.reduce(function(sum, item) { return sum + numberValue(item.basePrice); }, 0), selectedOptions: items.length === 1 ? items[0].selectedOptions || [] : [],
    items: items, quantity: quantity, outstandingAmount: getOutstandingAmount(order, detail), createdAt: isoDateTime(order.CreatedAt)
  };
}

function parseOrderDetail(order) {
  var detail = {};
  try { detail = JSON.parse(String(order.Options || '{}')); } catch (e) { detail = {}; }
  if (!Array.isArray(detail.items)) detail.items = [{ itemId: detail.itemId || '', itemName: detail.itemName || '餐點資料格式錯誤', basePrice: numberValue(detail.basePrice), quantity: 1, selectedOptions: detail.selectedOptions || [] }];
  return detail;
}

function normalizeOrderItems(detail) {
  return (detail.items || []).map(function(item) {
    return { itemId: item.itemId || '', itemName: item.itemName || '未命名餐點', basePrice: numberValue(item.basePrice), quantity: Math.max(1, numberValue(item.quantity || 1)), unitPrice: numberValue(item.unitPrice || item.basePrice), lineTotal: numberValue(item.lineTotal || (numberValue(item.unitPrice || item.basePrice) * Math.max(1, numberValue(item.quantity || 1)))), selectedOptions: item.selectedOptions || [] };
  });
}

function getOutstandingAmount(order, detail) {
  if (!order || String(order.PaymentStatus) === 'PaidWallet' || String(order.PaymentStatus) === 'PaidCash') return 0;
  var value = Number(detail && detail.outstandingAmount);
  if (isFinite(value) && value >= 0) return value;
  return String(order.PaymentStatus) === 'UnpaidCash' || String(order.PaymentStatus) === 'PartiallyPaid' ? numberValue(order.TotalPrice) : 0;
}

function todayOrdersForUser(userId) {
  return getUserOrders(userId).filter(function(order) { return order.orderDate === todayString(); });
}

function isOrderToday(order) {
  var session = findOne('Sessions', 'SessionID', order.SessionID);
  return session && isoDate(session.OrderDate) === todayString();
}

function storeName(storeId) {
  var store = findOne('Stores', 'StoreID', storeId);
  return store ? String(store.Name) : '未命名店家';
}

function passwordHash(password) { return digest(String(password) + getProperty('PASSWORD_SALT', 'CHANGE_ME')); }
function inviteCodeHash(code) { return digest('class-code:' + String(code).trim().toUpperCase() + getProperty('PASSWORD_SALT', 'CHANGE_ME')); }
function tokenHash(token) { return digest('reset:' + String(token) + getProperty('PASSWORD_SALT', 'CHANGE_ME')); }
function registrationCodeHash(studentNo, code) { return digest('register:' + String(studentNo) + ':' + String(code) + getProperty('PASSWORD_SALT', 'CHANGE_ME')); }
function digest(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value).map(function(byte) { var n = (byte + 256) % 256; return ('0' + n.toString(16)).slice(-2); }).join(''); }
function newId() { return Utilities.getUuid(); }
function nowIso() { return new Date().toISOString(); }
function todayString() { return Utilities.formatDate(new Date(), spreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd'); }
function isoDate(value) { var d = dateValue(value); return d ? Utilities.formatDate(d, spreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd') : ''; }
function isoDateTime(value) { var d = dateValue(value); return d ? d.toISOString() : ''; }
function formatDate(value) { var d = dateValue(value); return d ? Utilities.formatDate(d, spreadsheet().getSpreadsheetTimeZone(), 'yyyy/MM/dd') : ''; }
function formatDateTime(value) { var d = dateValue(value); return d ? Utilities.formatDate(d, spreadsheet().getSpreadsheetTimeZone(), 'yyyy/MM/dd HH:mm') : ''; }
function dateValue(value) { if (!value) return null; var d = value instanceof Date ? value : new Date(value); return isNaN(d.getTime()) ? null : d; }
function numberValue(value) { var n = Number(value); return isFinite(n) ? n : 0; }
function boolValue(value) { return value === true || String(value).toLowerCase() === 'true' || String(value) === '1'; }
function unique(value, index, arr) { return arr.indexOf(value) === index; }
function requiredText(value, label) { var text = String(value === undefined || value === null ? '' : value).trim(); if (!text) throw appError('MISSING_FIELD', '請填寫' + label + '。'); return text; }
function getProperty(name, fallback) { return PropertiesService.getScriptProperties().getProperty(name) || fallback; }
function withLock(callback) { var lock = LockService.getScriptLock(); try { lock.waitLock(30000); return callback(); } catch (err) { throw err; } finally { try { lock.releaseLock(); } catch (ignored) {} } }
function buildResetUrl(token) { var base = getProperty('FRONTEND_URL', ''); if (!base) throw appError('NOT_CONFIGURED', '尚未設定 FRONTEND_URL，無法寄送重設連結。'); return base.replace(/[?#].*$/, '').replace(/\/$/, '') + '?resetToken=' + encodeURIComponent(token); }
function parseBody(e) { if (!e || !e.postData || !e.postData.contents) return {}; try { return JSON.parse(e.postData.contents); } catch (err) { throw appError('BAD_JSON', '請求格式必須為 JSON。'); } }
function appError(code, message) { var err = new Error(code + '|' + message); err.name = 'LunchAppError'; return err; }
function publicError(err) { var parts = String(err && err.message || '').split('|'); return parts.length > 1 ? parts[1] : '系統暫時無法完成此操作，請稍後再試。'; }
function respond(payload) { return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON); }
function htmlEscape(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
