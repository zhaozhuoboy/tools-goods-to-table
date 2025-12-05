// options.js - 设置页面逻辑

const settingsForm = document.getElementById('settingsForm');
const testConnectionBtn = document.getElementById('testConnectionBtn');
const testTableBtn = document.getElementById('testTableBtn');
const resetBtn = document.getElementById('resetBtn');
const toggleSecret = document.getElementById('toggleSecret');
const appSecretInput = document.getElementById('appSecret');
const appIdInput = document.getElementById('appId');
const folderIdInput = document.getElementById('folderId');
const loadTablesBtn = document.getElementById('loadTablesBtn');
const tablesListGroup = document.getElementById('tablesListGroup');
const tablesList = document.getElementById('tablesList');
const tablesListHint = document.getElementById('tablesListHint');
const selectedTableInfo = document.getElementById('selectedTableInfo');
const selectedTableName = document.getElementById('selectedTableName');
const selectedTableToken = document.getElementById('selectedTableToken');
const statusMessage = document.getElementById('statusMessage');
const saveCredentialsBtn = document.getElementById('saveCredentialsBtn');
const editCredentialsBtn = document.getElementById('editCredentialsBtn');

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  initEventListeners();
});

// 初始化事件监听
function initEventListeners() {
  // 表单提交
  settingsForm.addEventListener('submit', handleSave);
  
  // 测试连接
  testConnectionBtn.addEventListener('click', handleTestConnection);
  
  // 验证表格
  testTableBtn.addEventListener('click', handleTestTable);
  
  // 重置
  resetBtn.addEventListener('click', handleReset);
  
  // 切换密码显示
  toggleSecret.addEventListener('click', () => {
    const type = appSecretInput.type === 'password' ? 'text' : 'password';
    appSecretInput.type = type;
  });
  
  // 加载表格列表
  loadTablesBtn.addEventListener('click', handleLoadTables);
  
  // 保存凭证
  saveCredentialsBtn.addEventListener('click', handleSaveCredentials);
  
  // 修改凭证
  editCredentialsBtn.addEventListener('click', handleEditCredentials);
}

// 加载设置
function loadSettings() {
  // 优先使用 spreadsheet_token，如果没有则使用 selectedTableToken（向后兼容）
  chrome.storage.local.get(['appId', 'appSecret', 'folderId', 'spreadsheet_token', 'selectedTableToken', 'selectedTableName', 'credentialsSaved'], (result) => {
    if (result.appId) {
      appIdInput.value = result.appId;
    }
    if (result.appSecret) {
      appSecretInput.value = result.appSecret;
    }
    if (result.folderId) {
      folderIdInput.value = result.folderId;
    }
    // 优先使用 spreadsheet_token，如果没有则使用 selectedTableToken
    const tableToken = result.spreadsheet_token || result.selectedTableToken;
    if (tableToken && result.selectedTableName) {
      selectedTableName.textContent = result.selectedTableName;
      selectedTableToken.textContent = tableToken;
      selectedTableInfo.style.display = 'block';
      testTableBtn.style.display = 'inline-flex';
    }
    
    // 如果凭证已保存，设置为只读状态
    if (result.credentialsSaved) {
      setCredentialsReadonly(true);
    }
  });
}

// 设置凭证输入框的只读状态
function setCredentialsReadonly(readonly) {
  appIdInput.readOnly = readonly;
  appSecretInput.readOnly = readonly;
  
  if (readonly) {
    appIdInput.classList.add('readonly');
    appSecretInput.classList.add('readonly');
    saveCredentialsBtn.style.display = 'none';
    editCredentialsBtn.style.display = 'inline-flex';
  } else {
    appIdInput.classList.remove('readonly');
    appSecretInput.classList.remove('readonly');
    saveCredentialsBtn.style.display = 'inline-flex';
    editCredentialsBtn.style.display = 'none';
  }
}

// 保存凭证
async function handleSaveCredentials() {
  const appId = appIdInput.value.trim();
  const appSecret = appSecretInput.value.trim();
  
  if (!appId || !appSecret) {
    showStatus('请填写 App ID 和 App Secret', 'error');
    return;
  }
  
  try {
    // 保存到浏览器存储
    await chrome.storage.local.set({
      appId,
      appSecret,
      credentialsSaved: true
    });
    
    // 清除缓存的 token
    await chrome.storage.local.remove(['tenantAccessToken', 'tokenExpire']);
    
    // 设置为只读状态
    setCredentialsReadonly(true);
    
    showStatus('✅ 凭证保存成功！', 'success');
  } catch (error) {
    console.error('保存失败:', error);
    showStatus('保存失败：' + error.message, 'error');
  }
}

// 修改凭证
function handleEditCredentials() {
  setCredentialsReadonly(false);
  showStatus('可以编辑凭证信息', 'info');
}

// 加载文件夹下的表格列表
// 
// 流程说明（按照飞书官方文档）：
// =================================
// 1. 先获取 tenant_access_token
//    - 接口：POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
//    - 文档：https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal
//    - 请求体：{ "app_id": "...", "app_secret": "..." }
//
// 2. 使用 token 请求文件夹下的文件列表
//    - 接口：GET https://open.feishu.cn/open-apis/drive/v1/files?folder_token={folder_token}
//    - 请求头：Authorization: Bearer {tenant_access_token}
//    - 返回：文件夹下的文件列表信息
//
// 3. 筛选并显示表格文件供用户选择
//    - 从文件列表中筛选 type 为 'sheet' 的文件
//    - 显示在界面上供用户选择
// =================================
//
// 注意：通过 background.js 统一处理 token 获取和 API 调用，确保流程正确
async function handleLoadTables() {
  const folderId = folderIdInput.value.trim();
  
  // 步骤 1: 验证文件夹 ID
  if (!folderId) {
    showStatus('请先输入文件夹 ID', 'warning');
    return;
  }
  
  // 步骤 2: 验证配置（App ID 和 App Secret）
  const result = await chrome.storage.local.get(['appId', 'appSecret']);
  if (!result.appId || !result.appSecret) {
    showStatus('请先配置 App ID 和 App Secret', 'warning');
    return;
  }
  
  try {
    loadTablesBtn.disabled = true;
    loadTablesBtn.classList.add('loading');
    showStatus('正在加载表格列表...', 'info');
    
    // 步骤 3: 通过消息传递请求 background.js 获取文件夹下的文件列表
    // background.js 会按照以下流程执行：
    //   1. 先调用 getTenantAccessToken() 获取 tenant_access_token（强制刷新，确保能看到请求）
    //   2. 使用获取到的 token 调用 drive/v1/files API 获取文件列表
    //   3. 筛选出表格文件并返回
    console.log('[Load Tables] 开始加载表格列表，文件夹 ID:', folderId);
    const response = await chrome.runtime.sendMessage({
      action: 'getFolderFiles',
      folderId: folderId,
      forceRefreshToken: true  // 强制刷新 token，确保能看到 tenant_access_token 请求
    });
    
    if (!response.success) {
      showStatus('❌ ' + response.error, 'error');
      return;
    }
    
    const spreadsheets = response.files || [];
    
    if (spreadsheets.length === 0) {
      tablesListGroup.style.display = 'none';
      tablesListHint.textContent = '该文件夹下没有找到表格文件';
      showStatus('⚠️ 该文件夹下没有找到表格文件', 'warning');
      return;
    }
    
    // 显示表格列表
    displayTablesList(spreadsheets);
    tablesListGroup.style.display = 'block';
    showStatus(`✅ 找到 ${spreadsheets.length} 个表格文件`, 'success');
    
  } catch (error) {
    console.error('加载表格列表失败:', error);
    showStatus('❌ 加载失败：' + error.message, 'error');
  } finally {
    loadTablesBtn.disabled = false;
    loadTablesBtn.classList.remove('loading');
  }
}

// 显示表格列表
// 根据飞书 API 返回的数据结构显示表格列表
// 数据结构：
// {
//   "token": "ZbMssCjYHhycnKt4xSbcdwaTnmh",
//   "name": "选品表格",
//   "type": "sheet",
//   "url": "https://ecn2vbwqqipg.feishu.cn/sheets/ZbMssCjYHhycnKt4xSbcdwaTnmh",
//   ...
// }
function displayTablesList(spreadsheets) {
  tablesList.innerHTML = '';
  
  if (!spreadsheets || spreadsheets.length === 0) {
    tablesListHint.textContent = '没有找到表格文件';
    return;
  }
  
  spreadsheets.forEach((spreadsheet) => {
    const tableItem = document.createElement('div');
    tableItem.className = 'table-item';
    
    // 格式化时间（如果提供了时间戳）
    let timeInfo = '';
    if (spreadsheet.modified_time) {
      const modifiedDate = new Date(spreadsheet.modified_time * 1000);
      timeInfo = `<div class="table-item-time">修改时间: ${modifiedDate.toLocaleString('zh-CN')}</div>`;
    }
    
    tableItem.innerHTML = `
      <div class="table-item-content">
        <svg class="table-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M21 5C21 4.46957 20.7893 3.96086 20.4142 3.58579C20.0391 3.21071 19.5304 3 19 3H5C4.46957 3 3.96086 3.21071 3.58579 3.58579C3.21071 3.96086 3 4.46957 3 5V19C3 19.5304 3.21071 20.0391 3.58579 20.4142C3.96086 20.7893 4.46957 21 5 21H19C19.5304 21 20.0391 20.7893 20.4142 20.4142C20.7893 20.0391 21 19.5304 21 19V5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M3 9H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M9 3V21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="table-item-info">
          <div class="table-item-name">${spreadsheet.name || '未命名表格'}</div>
          <div class="table-item-meta">Token: ${spreadsheet.token}</div>
          ${timeInfo}
        </div>
      </div>
      <button type="button" class="btn btn-select-table" data-token="${spreadsheet.token}" data-name="${spreadsheet.name || '未命名表格'}">
        选择
      </button>
    `;
    
    // 添加选择事件
    const selectBtn = tableItem.querySelector('.btn-select-table');
    if (selectBtn) {
      // 绑定点击事件
      selectBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        console.log('[Display Tables] 点击选择按钮:', {
          token: spreadsheet.token,
          name: spreadsheet.name
        });
        
        // 将选中的表格 token 存储为 spreadsheet_token
        await selectTable(spreadsheet.token, spreadsheet.name || '未命名表格', spreadsheet.url);
      });
    } else {
      console.error('[Display Tables] ❌ 未找到选择按钮，表格项 HTML:', tableItem.innerHTML);
    }
    
    tablesList.appendChild(tableItem);
  });
  
  tablesListHint.textContent = `共找到 ${spreadsheets.length} 个表格，请选择一个用于存储数据`;
}

// 选择表格
// 将用户选择的表格 token 存储为 spreadsheet_token，用于后续向表格中插入数据
async function selectTable(tableToken, tableName, tableUrl) {
  console.log('[Select Table] 开始选择表格:', {
    token: tableToken,
    name: tableName,
    url: tableUrl
  });
  
  if (!tableToken) {
    console.error('[Select Table] 表格 token 为空');
    showStatus('❌ 表格 token 无效', 'error');
    return;
  }
  
  try {
    // 保存选中的表格信息
    // 使用 spreadsheet_token 作为主键（后续插入数据时使用）
    // 同时保存 selectedTableToken 和 selectedTableName 以保持向后兼容
    const saveData = {
      spreadsheet_token: tableToken,  // 主键：用于后续向表格中插入数据
      selectedTableToken: tableToken,  // 兼容旧代码
      selectedTableName: tableName
    };
    
    // 如果提供了表格 URL，也保存下来（用于快速打开表格）
    if (tableUrl) {
      saveData.spreadsheet_url = tableUrl;
    }
    
    await chrome.storage.local.set(saveData);
    
    console.log('[Select Table] ✅ 表格信息已保存到存储:', {
      name: tableName,
      token: tableToken,
      storage_key: 'spreadsheet_token'
    });
    
    // 验证存储是否成功
    const saved = await chrome.storage.local.get(['spreadsheet_token', 'selectedTableToken', 'selectedTableName']);
    console.log('[Select Table] 验证存储结果:', saved);
    
    // 更新显示
    if (selectedTableName && selectedTableToken) {
      selectedTableName.textContent = tableName;
      selectedTableToken.textContent = tableToken;
      selectedTableInfo.style.display = 'block';
      testTableBtn.style.display = 'inline-flex';
      console.log('[Select Table] ✅ UI 已更新');
    } else {
      console.error('[Select Table] ❌ 未找到 UI 元素:', {
        selectedTableName: !!selectedTableName,
        selectedTableToken: !!selectedTableToken
      });
    }
    
    // 高亮选中的表格
    const allTableItems = document.querySelectorAll('.table-item');
    console.log('[Select Table] 找到', allTableItems.length, '个表格项');
    
    allTableItems.forEach(item => {
      item.classList.remove('selected');
      const btn = item.querySelector('[data-token="' + tableToken + '"]');
      if (btn) {
        item.classList.add('selected');
        console.log('[Select Table] ✅ 已高亮表格项');
      }
    });
    
    showStatus('✅ 已选择表格：' + tableName + ' (Token: ' + tableToken + ')', 'success');
  } catch (error) {
    console.error('[Select Table] ❌ 保存表格选择失败:', error);
    showStatus('❌ 保存失败：' + error.message, 'error');
  }
}

// 保存设置（主要保存文件夹 ID 和选中的表格）
async function handleSave(e) {
  e.preventDefault();
  
  const folderId = folderIdInput.value.trim();
  // 优先使用 spreadsheet_token，如果没有则使用 selectedTableToken（向后兼容）
  const current = await chrome.storage.local.get(['spreadsheet_token', 'selectedTableToken', 'selectedTableName', 'spreadsheet_url']);
  
  if (!folderId) {
    showStatus('请填写文件夹 ID', 'error');
    return;
  }
  
  const tableToken = current.spreadsheet_token || current.selectedTableToken;
  if (!tableToken) {
    showStatus('请先选择一个表格', 'error');
    return;
  }
  
  try {
    // 获取当前保存状态
    const saved = await chrome.storage.local.get(['credentialsSaved']);
    
    // 保存到存储
    const saveData = {
      folderId,
      spreadsheet_token: tableToken,  // 使用新的键名
      selectedTableToken: tableToken,  // 保持向后兼容
      selectedTableName: current.selectedTableName
    };
    
    // 如果存在表格 URL，也保存下来
    if (current.spreadsheet_url) {
      saveData.spreadsheet_url = current.spreadsheet_url;
    }
    
    if (!saved.credentialsSaved) {
      // 如果凭证未保存，也保存凭证（兼容旧逻辑）
      saveData.appId = appIdInput.value.trim();
      saveData.appSecret = appSecretInput.value.trim();
    }
    
    await chrome.storage.local.set(saveData);
    
    // 清除缓存的 token
    await chrome.storage.local.remove(['tenantAccessToken', 'tokenExpire']);
    
    showStatus('✅ 设置保存成功！', 'success');
  } catch (error) {
    console.error('保存失败:', error);
    showStatus('保存失败：' + error.message, 'error');
  }
}

// 测试连接
// 通过 background.js 获取 token，测试凭证是否有效
async function handleTestConnection() {
  const appId = document.getElementById('appId').value.trim();
  const appSecret = appSecretInput.value.trim();
  
  if (!appId || !appSecret) {
    showStatus('请先填写 App ID 和 App Secret', 'warning');
    return;
  }
  
  // 先临时保存凭证用于测试
  const originalConfig = await chrome.storage.local.get(['appId', 'appSecret']);
  await chrome.storage.local.set({
    appId,
    appSecret
  });
  
  // 清除缓存的 token，强制重新获取
  await chrome.storage.local.remove(['tenantAccessToken', 'tokenExpire']);
  
  try {
    testConnectionBtn.disabled = true;
    testConnectionBtn.classList.add('loading');
    showStatus('正在测试连接...', 'info');
    
    // 通过消息传递请求 background.js 获取 token
    const response = await chrome.runtime.sendMessage({
      action: 'getTenantAccessToken'
    });
    
    if (response.success && response.token) {
      showStatus('✅ 连接成功！Token 获取正常', 'success');
    } else {
      showStatus('❌ 连接失败：' + (response.error || '未知错误'), 'error');
    }
  } catch (error) {
    console.error('测试连接失败:', error);
    showStatus('❌ 连接失败：' + error.message, 'error');
  } finally {
    // 恢复原始配置
    await chrome.storage.local.set(originalConfig);
    // 再次清除 token
    await chrome.storage.local.remove(['tenantAccessToken', 'tokenExpire']);
    
    testConnectionBtn.disabled = false;
    testConnectionBtn.classList.remove('loading');
  }
}

// 验证表格
// 根据飞书 prepend-data API 文档调整验证逻辑
// 文档：https://open.feishu.cn/document/server-docs/docs/sheets-v3/data-operation/prepend-data
// 
// 验证步骤：
// 1. 获取 tenant_access_token
// 2. 获取表格元信息，验证表格是否存在
// 3. 检查是否有可用的工作表（sheet）
// 4. 验证是否具有写入权限（读取第一个工作表的数据）
async function handleTestTable() {
  // 优先使用 spreadsheet_token，如果没有则使用 selectedTableToken（向后兼容）
  const current = await chrome.storage.local.get(['spreadsheet_token', 'selectedTableToken', 'selectedTableName']);
  
  const tableToken = current.spreadsheet_token || current.selectedTableToken;
  if (!tableToken) {
    showStatus('请先选择一个表格', 'warning');
    return;
  }
  
  // 获取配置
  const result = await chrome.storage.local.get(['appId', 'appSecret']);
  if (!result.appId || !result.appSecret) {
    showStatus('请先配置 App ID 和 App Secret', 'warning');
    return;
  }
  
  try {
    testTableBtn.disabled = true;
    testTableBtn.classList.add('loading');
    showStatus('正在验证表格...', 'info');
    
    // 步骤 1: 获取 tenant_access_token
    const tokenResponse = await chrome.runtime.sendMessage({
      action: 'getTenantAccessToken'
    });
    
    if (!tokenResponse.success || !tokenResponse.token) {
      showStatus('❌ 获取 Token 失败：' + (tokenResponse.error || '未知错误'), 'error');
      return;
    }
    
    const token = tokenResponse.token;
    
    // 步骤 2: 验证表格（获取表格元信息，只要表格存在且有 sheet 即可）
    // 根据 prepend-data API 文档，验证表格的逻辑：
    // 1. 获取表格元信息（获取工作表列表）
    // 2. 检查是否有工作表（sheet），只要有 sheet 就可以插入数据
    // 3. 不需要验证工作表可访问性，有 sheet 即可用于插入数据
    // 接口文档：https://open.feishu.cn/document/server-docs/docs/sheets-v3/data-operation/prepend-data
    showStatus('正在检查表格信息...', 'info');
    
    // 获取表格元信息
    // 使用 v2 版本的 metainfo 接口获取表格元信息
    const metaResponse = await fetch(`https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${tableToken}/metainfo`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!metaResponse.ok) {
      throw new Error(`HTTP 错误: ${metaResponse.status} ${metaResponse.statusText}`);
    }
    
    const metaData = await metaResponse.json();
    
    // 验证元信息响应
    if (metaData.code !== 0) {
      let errorMsg = metaData.msg || '未知错误';
      if (metaData.code === 99991663) {
        errorMsg = '权限不足，请检查应用是否有访问表格的权限';
      } else if (metaData.code === 1254047) {
        errorMsg = '表格不存在或无法访问，请检查表格 Token 是否正确';
      }
      showStatus('❌ 表格验证失败：' + errorMsg, 'error');
      return;
    }
    
    // 检查是否有可用的工作表（sheet）
    // 数据在 data.sheets 中，每个 sheet 有 sheetId 字段
    const sheets = metaData.data?.sheets || [];
    if (sheets.length === 0) {
      showStatus('❌ 表格中没有可用的工作表，无法插入数据', 'error');
      return;
    }
    
    // 获取第一个工作表的信息（我们只使用第一个 sheet）
    const firstSheet = sheets[0];
    const sheetId = firstSheet.sheetId;  // 注意：字段名是 sheetId，不是 sheet_id
    const sheetTitle = firstSheet.title || 'Sheet1';
    const tableTitle = metaData.data?.properties?.title || '表格';
    
    console.log('[Test Table] ✅ 表格验证成功:', {
      spreadsheet_token: tableToken,
      table_title: tableTitle,
      sheet_count: sheets.length,
      first_sheet_id: sheetId,
      first_sheet_title: sheetTitle,
      status: '可以正常插入数据'
    });
    
    // 验证成功提示
    const sheetCountInfo = sheets.length > 1 
      ? `共 ${sheets.length} 个工作表，` 
      : '';
    
    const sheetInfo = `${sheetCountInfo}将使用工作表：${sheetTitle} (ID: ${sheetId})`;
    
    showStatus(`✅ 表格验证成功！${sheetInfo}`, 'success');
    
    // 显示表格详细信息
    if (current.selectedTableName) {
      console.log('[Test Table] 表格详细信息:', {
        表格名称: current.selectedTableName,
        表格Token: tableToken,
        工作表数量: sheets.length || 1,
        默认工作表: sheetTitle,
        工作表ID: sheetId,
        状态: '可以正常插入数据'
      });
    }
    
  } catch (error) {
    console.error('[Test Table] 验证表格失败:', error);
    showStatus('❌ 验证失败：' + error.message, 'error');
  } finally {
    testTableBtn.disabled = false;
    testTableBtn.classList.remove('loading');
  }
}

// 重置设置
function handleReset() {
  if (confirm('确定要重置所有设置吗？')) {
    settingsForm.reset();
    tablesListGroup.style.display = 'none';
    selectedTableInfo.style.display = 'none';
    testTableBtn.style.display = 'none';
    tablesList.innerHTML = '';
    // 清除所有存储的数据，包括新的 spreadsheet_token
    chrome.storage.local.remove(['appId', 'appSecret', 'folderId', 'spreadsheet_token', 'selectedTableToken', 'selectedTableName', 'tenantAccessToken', 'tokenExpire', 'credentialsSaved', 'appTokenCache']);
    setCredentialsReadonly(false);
    showStatus('设置已重置', 'info');
  }
}

// 显示状态消息
function showStatus(message, type = 'info') {
  // 如果是多行消息，使用 innerHTML 并保留换行符
  if (message.includes('\n')) {
    // 将换行符转换为 <br>，同时转义 HTML 特殊字符
    const escapedMessage = message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    statusMessage.innerHTML = escapedMessage;
  } else {
    statusMessage.textContent = message;
  }
  
  statusMessage.className = `status-message ${type} show`;
  
  // 根据消息类型设置不同的显示时长
  if (type === 'success') {
    setTimeout(() => {
      statusMessage.classList.remove('show');
    }, 3000);
  } else if (type === 'error') {
    // 错误消息（特别是包含详细说明的）显示更长时间
    const duration = message.includes('\n') ? 15000 : 5000;
    setTimeout(() => {
      statusMessage.classList.remove('show');
    }, duration);
  }
}

// 防抖函数
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

