// SharePoint Configuration
// Replace these values with your actual Azure AD app registration details

export const SharePointConfig = {
  // Extract site URL from the provided URL
  siteUrl: 'https://humanpoweredhealth.sharepoint.com/sites/hph-BHARAT-asset',
  
  // You need to register an app in Azure AD and get these values
  // Go to: https://portal.azure.com -> Azure Active Directory -> App registrations
  clientId: '6ef7838b-3f91-427b-ae49-d17213d254fd', // Replace with your Azure AD Application (client) ID
  tenantId: 'ca45db7d-14c1-4213-a3b0-ef6c5d1ac0bc', // Replace with your Azure AD Directory (tenant) ID
  
  // Default list name (you can change this)
  defaultListName: 'Assets', // Default to Assets list
};

// Instructions:
// 1. Go to Azure Portal (https://portal.azure.com)
// 2. Navigate to Azure Active Directory > App registrations
// 3. Click "New registration"
// 4. Name your app and set redirect URI (for mobile: expo-auth-session will handle this)
// 5. Go to "API permissions" and add:
//    - Microsoft Graph: Sites.ReadWrite.All
//    - SharePoint: Sites.ReadWrite.All
// 6. Copy the Application (client) ID and Directory (tenant) ID
// 7. Update the values above

