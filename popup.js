// popup.js - 弹窗页面逻辑

// DOM 元素
const extractBtn = document.getElementById('extractBtn');
const clearBtn = document.getElementById('clearBtn');
const settingsBtn = document.getElementById('settingsBtn');
const productForm = document.getElementById('productForm');
const submitBtn = document.getElementById('submitBtn');
const openTableBtn = document.getElementById('openTableBtn');
const statusMessage = document.getElementById('statusMessage');
const imagePreview = document.getElementById('imagePreview');
const imagePreviewContainer = document.getElementById('imagePreviewContainer');
const productImageInput = document.getElementById('productImage');

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  // 先加载保存的数据，然后初始化默认值（只对空字段设置）
  loadSavedData();
  initDefaultValues();
  checkCurrentTab();
});

// 初始化事件监听
function initEventListeners() {
  // 提取按钮
  extractBtn.addEventListener('click', handleExtract);
  
  // 清空按钮
  clearBtn.addEventListener('click', handleClear);
  
  // 设置按钮
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // 顶部提交按钮
  submitBtn.addEventListener('click', (e) => {
    e.preventDefault();
    productForm.requestSubmit();
  });
  
  // 表单提交
  productForm.addEventListener('submit', handleSubmit);
  
  // 打开表格按钮
  openTableBtn.addEventListener('click', handleOpenTable);
  
  // 图片输入变化（如果存在）
  if (productImageInput) {
    productImageInput.addEventListener('input', handleImageInputChange);
  }
  
  // 输入框变化时保存
  const inputs = productForm.querySelectorAll('input');
  inputs.forEach(input => {
    // 跳过隐藏字段
    if (input.type !== 'hidden') {
      input.addEventListener('input', debounce(saveFormData, 500));
    }
  });
}

// 检查当前标签页
async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab.url;
    
    if (url && (url.includes('item.jd.com') || url.includes('item.m.jd.com'))) {
      // 在京东商品页面，可以提取
      extractBtn.disabled = false;
      extractBtn.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>提取商品信息';
      
      // 自动提取商品信息
      await handleExtract();
    } else {
      // 不在京东商品页面
      extractBtn.disabled = true;
      extractBtn.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8V12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 16H12.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>请在京东商品页面使用';
    }
  } catch (error) {
    console.error('检查标签页失败:', error);
  }
}

// 提取商品信息
async function handleExtract() {
  try {
    showStatus('正在提取商品信息...', 'info');
    extractBtn.disabled = true;
    extractBtn.classList.add('loading');
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // 注入内容脚本并提取信息
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: extractProductInfo
    });
    
    if (results && results[0] && results[0].result) {
      const productInfo = results[0].result;
      fillForm(productInfo);
      showStatus('商品信息提取成功！', 'success');
    } else {
      showStatus('提取失败，请手动填写信息', 'warning');
    }
  } catch (error) {
    console.error('提取失败:', error);
    showStatus('提取失败：' + error.message, 'error');
  } finally {
    extractBtn.disabled = false;
    extractBtn.classList.remove('loading');
  }
}

// 从页面提取商品信息（在页面上下文中执行）
function extractProductInfo() {
  const info = {
    category: '',
    shopName: '',
    productName: '',
    originalPrice: '',
    productUrl: window.location.href,
    productImage: '',
    productSku: '',
    // 以下字段保持为空，使用默认值
    activityId: '',
    coupon: '',
    priceAfterCoupon: '',
    commissionRate: '',
    serviceRate: ''
  };
  
  try {
    // 提取一级类目 - 只提取 class 为 "item first" 的第一个元素
    const categoryEl = document.querySelector('.item.first, .item.first a');
    if (categoryEl) {
      info.category = categoryEl.textContent.trim() || '';
    }
    
    // 提取店铺名称
    const shopEl = document.querySelector('.top-shop-info .top-name');
    if (shopEl) {
      info.shopName = shopEl.textContent.trim();
    }
    
    // 提取商品名称
    const nameEl = document.querySelector('.sku-title-name');
    if (nameEl) {
      info.productName = nameEl.textContent.trim();
    }
    
    // 提取原价（页面价）
    const priceEl = document.querySelector('.price .p-price .price, .summary-price .p-price, [class*="price"] [class*="J-price"]');
    if (priceEl) {
      const priceText = priceEl.textContent.trim().replace(/[^\d.]/g, '');
      info.originalPrice = priceText;
    }
    
    // 提取商品图片
    const imageEl = document.querySelector('.spec-img img, .preview-img img, [class*="preview"] img');
    if (imageEl) {
      info.productImage = imageEl.src || imageEl.getAttribute('data-src') || '';
    }
    
    // 提取SKU
    const urlParams = new URLSearchParams(window.location.search);
    const sku = urlParams.get('sku') || urlParams.get('id') || 
                window.location.pathname.match(/\/(\d+)\.html/)?.[1] || '';
    info.productSku = sku;
    
  } catch (error) {
    console.error('提取信息时出错:', error);
  }
  
  return info;
}

// 初始化默认值
function initDefaultValues() {
  // 设置默认值（如果字段为空或未设置）
  const defaultValues = {
    customerPlatform: '京东',
    calculationMethod: '按比例',
    productAttribute: '一手',
    channel: '京东',
    promotionMethod: '精推品',
    settlementMethod: '线上'
  };
  
  Object.keys(defaultValues).forEach(fieldId => {
    const field = document.getElementById(fieldId);
    if (field && (!field.value || field.value.trim() === '')) {
      field.value = defaultValues[fieldId];
    }
  });
  
  // 确保空字段保持为空（这些字段不应该有默认值）
  const emptyFields = ['activityId', 'coupon', 'priceAfterCoupon', 'commissionRate', 'serviceRate'];
  emptyFields.forEach(fieldId => {
    const field = document.getElementById(fieldId);
    if (field && (!field.value || field.value.trim() === '')) {
      field.value = '';
    }
  });
}

// 填充表单
function fillForm(data) {
  document.getElementById('category').value = data.category || '';
  document.getElementById('shopName').value = data.shopName || '';
  document.getElementById('productName').value = data.productName || '';
  document.getElementById('productUrl').value = data.productUrl || '';
  document.getElementById('productImage').value = data.productImage || '';
  document.getElementById('productSku').value = data.productSku || '';
  
  // 原价（之前是 pagePrice）
  const originalPrice = document.getElementById('originalPrice');
  if (originalPrice) {
    originalPrice.value = data.originalPrice || data.pagePrice || '';
  }
  
  // 活动ID、优惠券、券后价、佣金率、服务费率保持为空（使用默认空值）
  const emptyFields = ['activityId', 'coupon', 'priceAfterCoupon', 'commissionRate', 'serviceRate'];
  emptyFields.forEach(fieldId => {
    const field = document.getElementById(fieldId);
    if (field && data[fieldId] !== undefined) {
      field.value = data[fieldId] || '';
    }
  });
  
  // 更新图片预览
  if (data.productImage) {
    updateImagePreview(data.productImage);
  }
  
  // 重新初始化默认值（确保默认值字段不被覆盖）
  initDefaultValues();
  
  // 保存数据
  saveFormData();
}

// 清空表单
function handleClear() {
  if (confirm('确定要清空所有表单数据吗？')) {
    productForm.reset();
    if (imagePreview) {
      imagePreview.style.display = 'none';
      imagePreview.src = '';
    }
    clearSavedData();
    // 重新初始化默认值
    initDefaultValues();
    showStatus('表单已清空', 'info');
  }
}

// 处理图片输入变化
function handleImageInputChange() {
  if (!productImageInput) return;
  const url = productImageInput.value.trim();
  if (url && imagePreview) {
    updateImagePreview(url);
  } else if (imagePreview) {
    imagePreview.style.display = 'none';
  }
}

// 更新图片预览
function updateImagePreview(url) {
  if (!imagePreview) return;
  imagePreview.src = url;
  imagePreview.style.display = 'block';
  imagePreview.onerror = () => {
    if (imagePreview) {
      imagePreview.style.display = 'none';
    }
  };
}

// 表单提交
async function handleSubmit(e) {
  e.preventDefault();
  
  try {
    // 验证表单
    if (!productForm.checkValidity()) {
      productForm.reportValidity();
      return;
    }
    
    // 获取表单数据
    const formData = new FormData(productForm);
    const data = {
      category: formData.get('category'),
      shopName: formData.get('shopName'),
      customerPlatform: formData.get('customerPlatform') || '京东',
      productName: formData.get('productName'),
      productUrl: formData.get('productUrl'),
      productSku: formData.get('productSku') || '',
      activityId: formData.get('activityId') || '',
      originalPrice: parseFloat(formData.get('originalPrice')) || 0,
      coupon: parseFloat(formData.get('coupon')) || 0,
      priceAfterCoupon: parseFloat(formData.get('priceAfterCoupon')) || 0,
      commissionRate: parseFloat(formData.get('commissionRate')) || 0,
      serviceRate: parseFloat(formData.get('serviceRate')) || 0,
      calculationMethod: formData.get('calculationMethod') || '按比例',
      productAttribute: formData.get('productAttribute') || '一手',
      channel: formData.get('channel') || '京东',
      promotionMethod: formData.get('promotionMethod') || '精推品',
      settlementMethod: formData.get('settlementMethod') || '线上',
      productImage: formData.get('productImage') || ''
    };
    
    // 显示加载状态
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    showStatus('正在同步到飞书表格...', 'info');
    
    // 发送消息到 background script 进行同步
    console.log('[Popup] 发送同步请求，数据:', data);
    const response = await chrome.runtime.sendMessage({
      action: 'syncToFeishu',
      data: data
    });
    
    console.log('[Popup] 收到同步响应:', response);
    
    // 检查响应是否为空或未定义
    if (!response) {
      console.error('[Popup] ❌ 响应为空，可能是 background script 未响应');
      showStatus('❌ 同步失败：未收到响应，请检查浏览器控制台', 'error');
      return;
    }
    
    if (response.success) {
      console.log('[Popup] ✅ 同步成功！');
      showStatus('✅ 同步成功！', 'success');
      // 可选：清空表单或保留数据
      // handleClear();
    } else {
      console.error('[Popup] ❌ 同步失败:', response.error);
      showStatus('❌ 同步失败：' + (response.error || '未知错误'), 'error');
    }
  } catch (error) {
    console.error('[Popup] ❌ 提交失败:', error);
    showStatus('❌ 同步失败：' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove('loading');
  }
}

// 显示状态消息
function showStatus(message, type = 'info') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type} show`;
  
  // 3秒后自动隐藏（成功和错误消息）
  if (type === 'success' || type === 'error') {
    setTimeout(() => {
      statusMessage.classList.remove('show');
    }, 3000);
  }
}

// 保存表单数据
function saveFormData() {
  const formData = new FormData(productForm);
  const data = {};
  for (const [key, value] of formData.entries()) {
    data[key] = value;
  }
  chrome.storage.local.set({ formData: data });
}

// 加载保存的数据
function loadSavedData() {
  chrome.storage.local.get(['formData'], (result) => {
    if (result.formData) {
      const data = result.formData;
      
      // 填充所有字段
      const fields = [
        'category', 'shopName', 'customerPlatform', 'productName', 'productUrl', 
        'productSku', 'activityId', 'originalPrice', 'coupon', 'priceAfterCoupon',
        'commissionRate', 'serviceRate', 'calculationMethod', 'productAttribute',
        'channel', 'promotionMethod', 'settlementMethod', 'productImage'
      ];
      
      fields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field && data[fieldId] !== undefined && data[fieldId] !== null && data[fieldId] !== '') {
          field.value = data[fieldId];
        }
      });
      
      // 兼容旧数据中的 pagePrice 字段
      if (data.pagePrice && !data.originalPrice) {
        const originalPriceField = document.getElementById('originalPrice');
        if (originalPriceField) {
          originalPriceField.value = data.pagePrice;
        }
      }
      
      if (data.productImage) {
        updateImagePreview(data.productImage);
      }
    }
    // 注意：默认值初始化在 loadSavedData 之后调用
  });
}

// 清空保存的数据
function clearSavedData() {
  chrome.storage.local.remove(['formData']);
}

// 打开表格文档
async function handleOpenTable() {
  try {
    // 从存储中获取表格 URL
    const result = await chrome.storage.local.get(['spreadsheet_url', 'spreadsheet_token', 'selectedTableToken']);
    
    let tableUrl = result.spreadsheet_url;
    
    // 如果没有保存的 URL，提示用户去设置页面选择表格
    if (!tableUrl) {
      const tableToken = result.spreadsheet_token || result.selectedTableToken;
      if (!tableToken) {
        showStatus('请先在设置页面配置并选择表格', 'warning');
      } else {
        showStatus('未找到表格链接，请去设置页面重新选择表格以保存链接', 'warning');
      }
      // 打开设置页面
      setTimeout(() => {
        chrome.runtime.openOptionsPage();
      }, 2000);
      return;
    }
    
    // 验证 URL 格式
    try {
      new URL(tableUrl);
    } catch (error) {
      showStatus('表格链接格式错误，请检查设置', 'error');
      setTimeout(() => {
        chrome.runtime.openOptionsPage();
      }, 2000);
      return;
    }
    
    // 在新标签页中打开表格
    chrome.tabs.create({ url: tableUrl });
    showStatus('正在打开表格...', 'info');
    
  } catch (error) {
    console.error('打开表格失败:', error);
    showStatus('打开表格失败：' + error.message, 'error');
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

