// background.js - 后台服务脚本
//
// 飞书 API 调用流程说明：
// ====================
// 所有飞书 API 调用都必须遵循以下流程：
//
// 1. **先获取 tenant_access_token**
//    - 调用 getTenantAccessToken(appId, appSecret)
//    - 接口：POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
//    - 文档：https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal
//
// 2. **使用 token 调用其他 API**
//    - 在请求头中添加：Authorization: Bearer {tenant_access_token}
//    - 例如：获取文件夹列表、获取表格信息、写入数据等
//
// 注意：
// - token 有效期为 2 小时（7200 秒）
// - 代码中已实现 token 缓存机制，避免重复请求
// - 缓存会在过期前 5 分钟自动刷新
//
// ====================

// 监听来自 popup 和 options 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] 收到消息:', request.action);
  
  if (request.action === 'syncToFeishu') {
    console.log('[Background] 开始同步到飞书表格，数据:', request.data);
    handleSyncToFeishu(request.data)
      .then(result => {
        console.log('[Background] 同步成功，结果:', result);
        sendResponse(result);
      })
      .catch(error => {
        console.error('[Background] 同步失败:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // 保持消息通道开放
  }
  
  if (request.action === 'getTenantAccessToken') {
    // 从 storage 获取配置
    chrome.storage.local.get(['appId', 'appSecret'], async (config) => {
      if (!config.appId || !config.appSecret) {
        sendResponse({ success: false, error: '请先配置 App ID 和 App Secret' });
        return;
      }
      
      try {
        const token = await getTenantAccessToken(config.appId, config.appSecret);
        sendResponse({ success: true, token });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    });
    return true; // 保持消息通道开放
  }
  
  if (request.action === 'getFolderFiles') {
    // 获取文件夹下的文件列表
    // 先清除 token 缓存，强制重新获取 token（确保能看到请求）
    handleGetFolderFiles(request.folderId, request.forceRefreshToken)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 保持消息通道开放
  }
});

// 同步到飞书表格
// 
// 流程说明：
// 1. 验证配置信息（App ID、App Secret、表格 Token）
// 2. **先获取 tenant_access_token**（这是调用飞书 API 的前提）
// 3. 使用 token 获取表格信息
// 4. 使用 token 读取/写入表格数据
//
// 注意：所有飞书 API 调用都必须先获取 tenant_access_token
async function handleSyncToFeishu(data) {
  console.log('[Sync] 开始同步流程，接收到的数据:', data);
  
  try {
    // 步骤 1: 获取并验证配置
    // 优先使用 spreadsheet_token，如果没有则使用 selectedTableToken（向后兼容）
    const config = await chrome.storage.local.get(['appId', 'appSecret', 'spreadsheet_token', 'selectedTableToken']);
    
    console.log('[Sync] 配置信息:', {
      hasAppId: !!config.appId,
      hasAppSecret: !!config.appSecret,
      hasSpreadsheetToken: !!config.spreadsheet_token,
      hasSelectedTableToken: !!config.selectedTableToken
    });
    
    if (!config.appId || !config.appSecret) {
      throw new Error('请先在设置页面配置飞书开发者凭证');
    }
    
    // 获取表格 token（优先使用 spreadsheet_token）
    const spreadsheetToken = config.spreadsheet_token || config.selectedTableToken;
    
    if (!spreadsheetToken) {
      throw new Error('请先在设置页面选择要使用的表格');
    }
    
    console.log('[Sync] 使用表格 Token:', spreadsheetToken);
    
    // 步骤 2: **先获取 tenant_access_token**
    // 这是调用所有飞书 API 的前提条件
    console.log('[Sync] 步骤 1: 获取 tenant_access_token...');
    const token = await getTenantAccessToken(config.appId, config.appSecret);
    console.log('[Sync] 步骤 2: tenant_access_token 获取成功');
    
    // 步骤 3: 获取表格信息，确定要写入的工作表
    // 使用 v2 版本的 metainfo 接口获取表格元信息
    // 数据结构：data.sheets 数组中包含工作表信息，每个 sheet 有 sheetId 字段
    console.log('[Sync] 步骤 3: 获取表格元信息...');
    let sheetId = null;
    let sheetTitle = 'Sheet1';  // 默认工作表名称
    
    try {
      const metaResponse = await fetch(`https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/metainfo`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!metaResponse.ok) {
        const errorText = await metaResponse.text();
        console.error('[Sync] 获取表格元信息 HTTP 错误:', errorText);
        throw new Error(`HTTP 错误: ${metaResponse.status} ${metaResponse.statusText}`);
      }
      
      // 安全地解析 JSON
      const responseText = await metaResponse.text();
      let metaData;
      try {
        metaData = JSON.parse(responseText);
        console.log('[Sync] 表格元信息响应:', metaData);
      } catch (parseError) {
        console.error('[Sync] JSON 解析失败:', parseError);
        console.error('[Sync] 响应体内容:', responseText);
        throw new Error(`响应格式错误: ${parseError.message}`);
      }
      
      // 数据在 data.sheets 中，字段名是 sheetId
      if (metaData.code === 0 && metaData.data?.sheets && metaData.data.sheets.length > 0) {
        // 直接使用第一个工作表（不考虑多个 sheet 的情况）
        sheetId = metaData.data.sheets[0].sheetId;
        sheetTitle = metaData.data.sheets[0].title || 'Sheet1';
        console.log('[Sync] ✅ 获取表格元信息成功:', {
          spreadsheet_token: spreadsheetToken,
          sheet_id: sheetId,
          sheet_title: sheetTitle,
          sheet_count: metaData.data.sheets.length
        });
      } else {
        throw new Error(metaData.msg || '表格中没有可用的工作表');
      }
    } catch (error) {
      console.error('[Sync] ❌ 获取表格元信息失败:', error);
      throw new Error('获取表格信息失败：' + error.message);
    }
    
    if (!sheetId) {
      throw new Error('无法获取工作表 ID，请检查表格是否有工作表');
    }
    
    console.log('[Sync] 使用的工作表 ID:', sheetId, '工作表名称:', sheetTitle);
    const skuUrl = data.productUrl + '?rid=10690'
    // 构建要写入的数据行
    const rowData = [
      data.category || '',
      data.shopName || '',
      data.productName || '',
      data.pagePrice || '',
      skuUrl || '',
      data.productImage || '',
      data.productSku || '',
    ];
    
    // 步骤 4: 写入数据
    // 根据 append-data API 文档，使用 values_append 接口在表格末尾追加数据
    // 接口文档：https://open.feishu.cn/document/server-docs/docs/sheets-v3/data-operation/append-data
    // 接口：POST https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/{spreadsheet_token}/values_append
    // 注意：append-data 是在表格数据末尾追加，range 格式只需要指定 sheetId，不需要单元格位置
    console.log('[Sync] 步骤 4: 写入数据到表格...');
    
    // append-data 接口的 range 格式：只需要 sheetId，不需要单元格位置
    // 数据会追加到指定工作表的末尾
    const appendRange = sheetId;
    
    console.log('[Sync] 准备写入的数据:', {
      range: appendRange,
      sheetId: sheetId,
      sheetTitle: sheetTitle,
      rowData: rowData
    });
    
    // 构建请求体
    // 根据 append-data API 文档，请求体格式应该是：
    // {
    //   "valueRange": {
    //     "range": "Q7PlXT",
    //     "values": [["数据1", "数据2", ...]]
    //   }
    // }
    const requestBody = {
      valueRange: {
        range: appendRange,
        values: [rowData]
      }
    };
    
    console.log('[Sync] 请求 URL:', `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values_append`);
    console.log('[Sync] 请求体:', JSON.stringify(requestBody, null, 2));
    
    const writeResponse = await fetch(`https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values_append`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    console.log('[Sync] 写入数据响应状态:', writeResponse.status, writeResponse.statusText);
    
    // 先读取响应体文本，然后尝试解析 JSON
    const responseText = await writeResponse.text();
    console.log('[Sync] 响应体内容:', responseText);
    
    if (!writeResponse.ok) {
      console.error('[Sync] ❌ 写入数据 HTTP 错误:', responseText);
      try {
        const errorData = JSON.parse(responseText);
        throw new Error(errorData.msg || `HTTP 错误: ${writeResponse.status} ${writeResponse.statusText}`);
      } catch (parseError) {
        // 如果无法解析为 JSON，直接使用原始错误信息
        throw new Error(`HTTP 错误: ${writeResponse.status} ${writeResponse.statusText}。响应: ${responseText.substring(0, 200)}`);
      }
    }
    
    // 尝试解析响应为 JSON
    let writeResult;
    try {
      writeResult = JSON.parse(responseText);
      console.log('[Sync] 写入数据响应结果:', writeResult);
    } catch (parseError) {
      console.error('[Sync] ❌ JSON 解析失败:', parseError);
      console.error('[Sync] 响应体内容:', responseText);
      throw new Error(`响应格式错误: ${parseError.message}。响应内容: ${responseText.substring(0, 200)}`);
    }
    
    if (writeResult.code === 0) {
      console.log('[Sync] ✅ 数据写入成功！');
      return { success: true };
    } else {
      console.error('[Sync] ❌ 写入数据失败:', writeResult);
      throw new Error(writeResult.msg || `同步失败，错误码: ${writeResult.code}`);
    }
  } catch (error) {
    console.error('[Sync] ❌ 同步失败:', error);
    throw error;
  }
}


// 获取 tenant_access_token
// 根据飞书开放平台官方文档：https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal
// 
// 流程说明：
// 1. 首先检查是否有缓存的 token，如果有且未过期，直接返回（除非 forceRefresh 为 true）
// 2. 如果没有缓存或已过期，调用飞书 API 获取新的 token
// 3. 将获取到的 token 缓存起来，有效期通常为 2 小时（7200 秒）
//
// 注意：调用所有飞书 API 之前都必须先获取此 token，然后在请求头中使用 Bearer token 进行认证
async function getTenantAccessToken(appId, appSecret, forceRefresh = false) {
  if (!appId || !appSecret) {
    throw new Error('App ID 和 App Secret 不能为空');
  }
  
  // 步骤 1: 检查缓存的 token 是否仍然有效（如果 forceRefresh 为 true，则跳过缓存）
  if (!forceRefresh) {
    const cached = await chrome.storage.local.get(['tenantAccessToken', 'tokenExpire']);
    
    if (cached.tenantAccessToken && cached.tokenExpire && Date.now() < cached.tokenExpire) {
      // 使用缓存的 token，避免重复请求
      console.log('[Token] 使用缓存的 tenant_access_token');
      return cached.tenantAccessToken;
    }
  } else {
    // 强制刷新，清除缓存
    console.log('[Token] 强制刷新，清除缓存的 token');
    await chrome.storage.local.remove(['tenantAccessToken', 'tokenExpire']);
  }
  
  // 步骤 2: 缓存无效或不存在，请求新的 token
  // 接口文档：https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal
  // 接口地址：POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
  console.log('[Token] 正在请求 tenant_access_token...');
  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret
    })
  });
  
  // 检查 HTTP 响应状态
  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Token] HTTP 错误响应:', errorText);
    throw new Error(`HTTP 错误: ${response.status} ${response.statusText}`);
  }
  
  // 解析响应数据（安全地解析 JSON）
  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseError) {
    console.error('[Token] JSON 解析失败:', parseError);
    console.error('[Token] 响应体内容:', responseText);
    throw new Error(`响应格式错误: ${parseError.message}`);
  }
  
  // 步骤 3: 验证响应并缓存 token
  if (data.code === 0 && data.tenant_access_token) {
    // 成功获取 token
    console.log('[Token] tenant_access_token 获取成功');
    // data.expire 单位为秒（通常为 7200，即 2 小时）
    // 提前 5 分钟过期，避免在临界时间使用时出现问题
    const expireTime = Date.now() + (data.expire - 300) * 1000;
    
    // 缓存 token 和过期时间
    await chrome.storage.local.set({
      tenantAccessToken: data.tenant_access_token,
      tokenExpire: expireTime
    });
    
    return data.tenant_access_token;
  } else {
    // 获取 token 失败
    throw new Error(data.msg || `获取 Token 失败，错误码: ${data.code}`);
  }
}

// 获取文件夹下的文件列表
// 
// 流程说明：
// 1. 验证文件夹 ID 和配置信息
// 2. **先获取 tenant_access_token**（这是关键步骤）
// 3. 使用获取到的 token 在请求头中认证
// 4. 调用飞书云文档 API 获取文件夹下的文件列表
// 5. 筛选出表格文件（type 为 'sheet'）
//
// 注意：必须先获取 tenant_access_token 才能调用其他飞书 API
async function handleGetFolderFiles(folderId, forceRefreshToken = true) {
  if (!folderId) {
    throw new Error('文件夹 ID 不能为空');
  }
  
  // 步骤 1: 获取配置信息
  const config = await chrome.storage.local.get(['appId', 'appSecret']);
  
  if (!config.appId || !config.appSecret) {
    throw new Error('请先配置 App ID 和 App Secret');
  }
  
  // 步骤 2: **先获取 tenant_access_token**
  // 这是调用所有飞书 API 的前提条件
  // forceRefreshToken 默认为 true，确保每次加载表格时都重新获取 token（方便调试和确保 token 有效）
  console.log('[Folder Files] 步骤 1: 获取 tenant_access_token...');
  const token = await getTenantAccessToken(config.appId, config.appSecret, forceRefreshToken);
  console.log('[Folder Files] 步骤 2: tenant_access_token 获取成功，开始请求文件夹文件列表...');
  
  // 步骤 3: 使用获取到的 token 请求文件夹下的文件列表
  // 接口文档：GET https://open.feishu.cn/open-apis/drive/v1/files?folder_token={folder_token}
  // 请求参数：
  //   - folder_token: 文件夹 ID（必填）
  //   - page_size: 每页返回的文件数量（可选，默认 50，最大 100）
  // 请求头：
  //   - Authorization: Bearer {tenant_access_token}（必填，使用步骤 2 获取的 token）
  //   - Content-Type: application/json
  // 注意：需要应用有云文档相关权限才能访问
  const response = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files?folder_token=${folderId}&page_size=100`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,  // 使用步骤 2 获取的 tenant_access_token 进行认证
      'Content-Type': 'application/json'
    }
  });
  
  // 先读取响应体文本
  const responseText = await response.text();
  
  if (!response.ok) {
    // 尝试解析响应体获取详细错误信息
    try {
      const errorData = JSON.parse(responseText);
      if (errorData.code === 1061004) {
        throw new Error(`权限不足 (${errorData.code}): ${errorData.msg || '访问被拒绝'}\n\n请检查应用权限配置，确保已开启云文档相关权限。`);
      }
      throw new Error(`API 错误: ${errorData.code} - ${errorData.msg || response.statusText}`);
    } catch (e) {
      if (e.message.includes('权限不足')) {
        throw e;
      }
      // 如果不是 JSON 解析错误，抛出原始错误
      if (e instanceof SyntaxError) {
        throw new Error(`HTTP 错误: ${response.status} ${response.statusText}。响应: ${responseText.substring(0, 200)}`);
      }
      throw e;
    }
  }
  
  // 安全地解析 JSON
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseError) {
    console.error('[Folder Files] JSON 解析失败:', parseError);
    console.error('[Folder Files] 响应体内容:', responseText);
    throw new Error(`响应格式错误: ${parseError.message}`);
  }
  
  if (data.code === 0) {
    // 解析返回的数据结构
    // 根据飞书 API 文档，返回的数据在 data.data.files 中
    // 数据结构示例：
    // {
    //   "code": 0,
    //   "data": {
    //     "files": [
    //       {
    //         "token": "ZbMssCjYHhycnKt4xSbcdwaTnmh",
    //         "name": "选品表格",
    //         "type": "sheet",
    //         ...
    //       }
    //     ],
    //     "has_more": false
    //   },
    //   "msg": "success"
    // }
    const files = data.data?.files || [];
    
    // 筛选出表格文件（type 为 'sheet'）
    // 注意：根据实际 API 返回，可能已经是表格文件，但为了保险起见还是筛选一下
    const spreadsheets = files.filter(file => file.type === 'sheet');
    
    console.log(`[Folder Files] 步骤 3: 成功获取 ${spreadsheets.length} 个表格文件`);
    
    return {
      success: true,
      files: spreadsheets
    };
  } else {
    let errorMsg = data.msg || '未知错误';
    let troubleshooting = '';
    
    // 处理常见的错误码
    if (data.code === 1061004) {
      errorMsg = '权限不足，访问被拒绝';
      troubleshooting = `
权限配置建议：
1. 登录飞书开放平台 (https://open.feishu.cn/)
2. 进入您的应用 → 权限管理
3. 确保已开启以下权限：
   - 云文档：drive:drive:readonly（查看、编辑和管理云空间中的文件）
   - 电子表格：sheets:spreadsheet:readonly 或 sheets:spreadsheet（查看、编辑和管理电子表格）
4. 保存权限配置后，可能需要等待几分钟生效
5. 如果问题仍然存在，请检查文件夹是否有正确的访问权限
      `.trim();
    } else if (data.code === 99991663) {
      errorMsg = '权限不足，请检查应用是否有访问该文件夹的权限';
      troubleshooting = '请确保应用已开启云文档相关权限，且目标文件夹可被访问';
    } else if (data.code === 1254047) {
      errorMsg = '文件夹不存在或无法访问，请检查文件夹 ID 是否正确';
    } else if (data.code === 99991668) {
      errorMsg = '应用未开通该 API 权限';
      troubleshooting = '请在飞书开放平台的应用权限管理中开启云文档相关权限';
    }
    
    // 如果有关联的排查链接，添加到错误信息中
    if (data.error?.log_id) {
      const logId = data.error.log_id;
      troubleshooting += `\n\n错误日志 ID: ${logId}`;
      if (data.error?.troubleshooter) {
        troubleshooting += `\n排查建议: ${data.error.troubleshooter}`;
      }
    }
    
    const fullError = troubleshooting ? `${errorMsg}\n\n${troubleshooting}` : errorMsg;
    throw new Error(fullError);
  }
}

