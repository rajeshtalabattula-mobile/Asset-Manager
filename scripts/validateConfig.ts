#!/usr/bin/env node

/**
 * Configuration Validation Script
 * Validates that SharePoint configuration is properly set up
 */

import { SharePointConfig } from '../config/sharepointConfig';

const GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_REGEX = /^https?:\/\/.+/;

function validateConfig() {
  console.log('🔍 Validating SharePoint Configuration...\n');

  let hasErrors = false;

  // Validate Site URL
  if (!SharePointConfig.siteUrl) {
    console.error('❌ Site URL is missing');
    hasErrors = true;
  } else if (!URL_REGEX.test(SharePointConfig.siteUrl)) {
    console.error('❌ Site URL is not a valid URL:', SharePointConfig.siteUrl);
    hasErrors = true;
  } else {
    console.log('✅ Site URL:', SharePointConfig.siteUrl);
  }

  // Validate Client ID
  if (!SharePointConfig.clientId) {
    console.error('❌ Client ID is missing');
    hasErrors = true;
  } else if (SharePointConfig.clientId === 'YOUR_CLIENT_ID_HERE') {
    console.error('❌ Client ID is still set to placeholder value');
    console.error('   Please update config/sharepointConfig.ts with your Azure AD Client ID');
    hasErrors = true;
  } else if (!GUID_REGEX.test(SharePointConfig.clientId)) {
    console.error('❌ Client ID is not in valid GUID format:', SharePointConfig.clientId);
    console.error('   Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
    hasErrors = true;
  } else {
    console.log('✅ Client ID:', SharePointConfig.clientId);
  }

  // Validate Tenant ID
  if (!SharePointConfig.tenantId) {
    console.error('❌ Tenant ID is missing');
    hasErrors = true;
  } else if (SharePointConfig.tenantId === 'YOUR_TENANT_ID_HERE') {
    console.error('❌ Tenant ID is still set to placeholder value');
    console.error('   Please update config/sharepointConfig.ts with your Azure AD Tenant ID');
    hasErrors = true;
  } else if (!GUID_REGEX.test(SharePointConfig.tenantId)) {
    console.error('❌ Tenant ID is not in valid GUID format:', SharePointConfig.tenantId);
    console.error('   Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
    hasErrors = true;
  } else {
    console.log('✅ Tenant ID:', SharePointConfig.tenantId);
  }

  // Validate Default List Name
  if (!SharePointConfig.defaultListName) {
    console.warn('⚠️  Default list name is not set');
  } else {
    console.log('✅ Default List Name:', SharePointConfig.defaultListName);
  }

  console.log('\n' + '='.repeat(50));

  if (hasErrors) {
    console.error('\n❌ Configuration validation failed!');
    console.error('\n📖 Please follow the setup guide: SETUP_AZURE_AD.md');
    process.exit(1);
  } else {
    console.log('\n✅ Configuration is valid!');
    console.log('\n🚀 You can now run the app and connect to SharePoint.');
    process.exit(0);
  }
}

// Run validation
validateConfig();

