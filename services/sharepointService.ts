import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

// Complete the auth session
WebBrowser.maybeCompleteAuthSession();

interface SharePointConfig {
  siteUrl: string;
  clientId: string;
  tenantId: string;
}

interface ListItem {
  [key: string]: any;
}

class SharePointService {
  private siteUrl: string;
  private clientId: string;
  private tenantId: string;
  private accessToken: string | null = null;
  private sharePointRoot: string = '';
  private siteId: string | null = null;
  private listIdCache: Map<string, string> = new Map();

  constructor(config: SharePointConfig) {
    this.siteUrl = config.siteUrl;
    this.clientId = config.clientId;
    this.tenantId = config.tenantId;
  }

  /**
   * Authenticate with SharePoint using OAuth 2.0
   */
  async authenticate(): Promise<string> {
    try {
      if (!this.clientId || this.clientId === 'YOUR_CLIENT_ID_HERE') {
        throw new Error(
          'Client ID not configured. Please update config/sharepointConfig.ts with your Azure AD Client ID.'
        );
      }

      if (!this.tenantId || this.tenantId === 'YOUR_TENANT_ID_HERE') {
        throw new Error(
          'Tenant ID not configured. Please update config/sharepointConfig.ts with your Azure AD Tenant ID.'
        );
      }

      // Generate redirect URI - in Expo Go it will use exp:// scheme, in custom builds it will use custom scheme
      // Try custom scheme first, but fall back to default if in Expo Go
      let redirectUri = AuthSession.makeRedirectUri({
        scheme: 'employee-assets',
        path: 'auth',
      });
      
      // If still using exp:// scheme (Expo Go), use the default without path to match Azure AD config
      if (redirectUri.startsWith('exp://')) {
        const defaultUri = AuthSession.makeRedirectUri();
        // Remove any path that Expo adds (like /--/auth) but keep the base URI with IP and port
        // Format should be: exp://IP:PORT/
        // Parse: exp://192.168.9.142:8081/--/auth -> exp://192.168.9.142:8081/
        if (defaultUri.includes('://')) {
          const match = defaultUri.match(/^(exp:\/\/[^\/]+)/);
          if (match) {
            redirectUri = match[1] + '/';
          } else {
            redirectUri = defaultUri;
          }
        } else {
          redirectUri = defaultUri;
        }
      }
      
      console.log('Generated Redirect URI:', redirectUri);
      console.log('⚠️ IMPORTANT: Add this EXACT URI to Azure AD → Authentication → Redirect URIs');
      console.log('⚠️ If using Expo Go, the URI will change when your IP changes. Consider adding multiple URIs.');
      const sharePointRoot = this.siteUrl.split('/sites/')[0];
      this.sharePointRoot = sharePointRoot;
      
      const scopes = [
        'https://graph.microsoft.com/Sites.ReadWrite.All',
        'https://graph.microsoft.com/User.Read',
      ];
      
      const discovery = {
        authorizationEndpoint: `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/authorize`,
        tokenEndpoint: `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`,
      };

      const request = new AuthSession.AuthRequest({
        clientId: this.clientId,
        scopes: scopes,
        responseType: AuthSession.ResponseType.Code,
        redirectUri,
        usePKCE: true,
      });

      const result = await request.promptAsync(discovery);

      if (result.type === 'success') {
        if (!result.params.code) {
          throw new Error('Authorization code not received');
        }
        
        const codeVerifier = (request as any).codeVerifier || 
                            (request as any)._codeVerifier ||
                            (request as any).code_verifier;
        
        const tokenExchangeConfig: any = {
          clientId: this.clientId,
          redirectUri: redirectUri,
          code: result.params.code,
          extraParams: {},
        };
        
        if (codeVerifier) {
          tokenExchangeConfig.extraParams.code_verifier = codeVerifier;
        }
        
        const tokenResult = await AuthSession.exchangeCodeAsync(
          tokenExchangeConfig,
          discovery
        );
        
        if (!tokenResult.accessToken) {
          throw new Error('Access token not received from token exchange');
        }
        
        this.accessToken = tokenResult.accessToken;
        this.siteId = null;
        this.listIdCache.clear();
        
        return this.accessToken;
      } else if (result.type === 'error') {
        const errorMessage = result.error?.message || result.error?.code || 'Unknown error';
        const errorDescription = result.error?.description || '';
        
        // Check if it's a redirect URI mismatch error
        if (errorMessage.includes('redirect_uri') || errorDescription.includes('redirect_uri') || 
            errorMessage.includes('redirect') || errorDescription.includes('redirect')) {
          throw new Error(
            `Redirect URI mismatch!\n\n` +
            `The redirect URI used: ${redirectUri}\n\n` +
            `Please add this exact URI to Azure AD:\n` +
            `1. Go to Azure Portal → Your App → Authentication\n` +
            `2. Under "Platform configurations", add "Mobile and desktop applications"\n` +
            `3. Add this exact redirect URI: ${redirectUri}\n` +
            `4. Save and try again.\n\n` +
            `Error details: ${errorMessage}${errorDescription ? ' - ' + errorDescription : ''}`
          );
        }
        
        throw new Error(`Authentication error: ${errorMessage}${errorDescription ? ' - ' + errorDescription : ''}`);
      } else if (result.type === 'cancel') {
        throw new Error('Authentication cancelled by user');
      } else {
        throw new Error(`Authentication failed: ${result.type}`);
      }
    } catch (error: any) {
      console.error('Authentication error:', error);
      if (error.message) {
        throw error;
      }
      throw new Error(`Authentication failed: ${error.toString()}`);
    }
  }

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * Make authenticated request to Microsoft Graph API
   */
  private async makeGraphRequest(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<any> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    const url = `https://graph.microsoft.com/v1.0/${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Microsoft Graph API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Get SharePoint site ID from Microsoft Graph API
   */
  private async getSiteId(): Promise<string> {
    if (this.siteId) {
      return this.siteId;
    }

    const urlObj = new URL(this.siteUrl);
    const hostname = urlObj.hostname;
    const pathParts = urlObj.pathname.split('/').filter(p => p);
    
    let sitePath = hostname;
    if (pathParts.length > 0) {
      sitePath += ':/' + pathParts.join('/');
    }
    
    const encodedSitePath = encodeURIComponent(sitePath);
    const data = await this.makeGraphRequest(`sites/${encodedSitePath}`);
    
    if (!data.id) {
      throw new Error('Site ID not found in response');
    }
    
    this.siteId = String(data.id);
    return this.siteId;
  }

  /**
   * Get list ID by list name
   */
  private async getListId(listName: string): Promise<string> {
    if (this.listIdCache.has(listName)) {
      return this.listIdCache.get(listName)!;
    }

    const siteId = await this.getSiteId();
    const listsData = await this.makeGraphRequest(`sites/${siteId}/lists`);
    const lists = listsData.value || [];
    
    const list = lists.find((l: any) => 
      l.displayName?.toLowerCase() === listName.toLowerCase() || 
      l.name?.toLowerCase() === listName.toLowerCase()
    );

    if (!list) {
      const availableLists = lists.map((l: any) => l.displayName || l.name).join(', ');
      throw new Error(
        `List "${listName}" not found.\n` +
        `Available lists: ${availableLists || 'none'}`
      );
    }

    this.listIdCache.set(listName, list.id);
    return list.id;
  }

  /**
   * Get all lists in the SharePoint site
   */
  async getLists(): Promise<any[]> {
    const siteId = await this.getSiteId();
    const response = await this.makeGraphRequest(`sites/${siteId}/lists`);
    return response.value || [];
  }

  /**
   * Get list by name
   */
  async getList(listName: string): Promise<any> {
    const listId = await this.getListId(listName);
    const siteId = await this.getSiteId();
    return await this.makeGraphRequest(`sites/${siteId}/lists/${listId}`);
  }

  /**
   * Extract employee name from employee item fields
   */
  private extractEmployeeName(employeeItem: any): string | null {
    const fields = employeeItem.fields || {};
    const empIdValue = fields.EmpID || fields.EmpId || fields.EmpID0 || fields.field_1;
    
    // Skip common non-name values
    const skipValues = ['Assigned', 'Available', 'Item', 'ContentType', 'Edit', 'Attachments'];
    const skipFieldNames = ['cardstatus', 'contenttype', 'accesscardno', 'assets', 'empid', 
                           'employeeid', 'lookupid', 'id', 'odata', 'author', 'editor'];
    
    // Try Title field first
    if (fields.Title) {
      const titleValue = String(fields.Title);
      if (!titleValue.match(/^HPH\s?\d+/) && titleValue !== empIdValue && 
          !skipValues.includes(titleValue) && titleValue.trim().length > 0) {
        return titleValue;
      }
    }
    
    // Try Employee field (Person or Group)
    if (fields.Employee) {
      if (typeof fields.Employee === 'object' && fields.Employee.displayName) {
        return fields.Employee.displayName;
      } else if (typeof fields.Employee === 'string' && 
                 !fields.Employee.match(/^HPH\s?\d+/) && 
                 fields.Employee !== empIdValue) {
        return fields.Employee;
      }
    }
    
    // Search all string fields for name-like values
    for (const [fieldName, fieldValue] of Object.entries(fields)) {
      if (typeof fieldValue !== 'string' || !fieldValue.trim()) continue;
      
      const value = String(fieldValue);
      const fieldNameLower = fieldName.toLowerCase();
      
      if (value.match(/^HPH\s?\d+/) || value === empIdValue) continue;
      if (fieldNameLower.includes('empid') || fieldNameLower.includes('emp_id')) continue;
      if (skipValues.includes(value)) continue;
      if (skipFieldNames.some(skip => fieldNameLower.includes(skip))) continue;
      if (value.match(/^\d+$/) || value.length < 3) continue;
      if (value.match(/^\d{4}-\d{2}-\d{2}/)) continue;
      
      // Check if it looks like a person's name
      if ((value.match(/^[A-Za-z\s]+$/) && value.length > 5) || 
          (value.includes(' ') && value.length > 8 && value.match(/^[A-Za-z\s.]+$/))) {
        return value;
      }
    }
    
    return null;
  }

  /**
   * Resolve Employee names for Access Cards
   */
  private async resolveEmployeeNames(records: any[], siteId: string, cachedEmployees?: any[]): Promise<void> {
    // Check if Employee field is already expanded
    const firstRecord = records[0];
    if (firstRecord.Employee && typeof firstRecord.Employee === 'object') {
      records.forEach((record: any) => {
        if (record.Employee && typeof record.Employee === 'object') {
          const employeeName = record.Employee.displayName || 
                             record.Employee.LookupValue || 
                             record.Employee.Title ||
                             record.Employee.email;
          if (employeeName && !employeeName.match(/^HPH\s?\d+/)) {
            record['Employee'] = employeeName;
            record['EmployeeName'] = employeeName;
          }
        }
      });
      return;
    }
    
    // Collect unique EmployeeLookupId values
    const employeeIdsToFetch = new Set<number>();
    records.forEach((record: any) => {
      if (record.EmployeeLookupId != null) {
        const empId = typeof record.EmployeeLookupId === 'string' 
          ? parseInt(record.EmployeeLookupId, 10) 
          : record.EmployeeLookupId;
        if (!isNaN(empId) && empId > 0) {
          employeeIdsToFetch.add(empId);
        }
      }
    });
    
    if (employeeIdsToFetch.size === 0) return;
    
    const employeeNameCache = new Map<number, string>();
    
    // First, try to use cached employees if provided
    if (cachedEmployees && cachedEmployees.length > 0) {
      for (const empId of Array.from(employeeIdsToFetch)) {
        const cachedEmployee = cachedEmployees.find((emp: any) => {
          const cachedId = typeof emp.Id === 'string' ? parseInt(emp.Id, 10) : emp.Id;
          return cachedId === empId;
        });
        
        if (cachedEmployee) {
          const employeeName = this.extractEmployeeName({ fields: cachedEmployee });
          if (employeeName) {
            employeeNameCache.set(empId, employeeName);
            employeeIdsToFetch.delete(empId);
          }
        }
      }
    }
    
    // If we still have IDs to fetch, get them from the API
    if (employeeIdsToFetch.size === 0) {
      // All employees found in cache, populate records and return
      records.forEach((record: any) => {
        if (record.EmployeeLookupId != null) {
          const employeeId = typeof record.EmployeeLookupId === 'string' 
            ? parseInt(record.EmployeeLookupId, 10) 
            : record.EmployeeLookupId;
          
          if (!isNaN(employeeId) && employeeId > 0) {
            const employeeName = employeeNameCache.get(employeeId);
            if (employeeName) {
              record['Employee'] = employeeName;
              record['EmployeeName'] = employeeName;
            } else {
              record['Employee'] = `[ID: ${employeeId}]`;
            }
          }
        }
      });
      return;
    }
    
    // Get Employees list ID for remaining IDs
    let employeesListId: string | null = null;
    try {
      employeesListId = await this.getListId('Employees');
    } catch (error) {
      // Employees list not found, try Access Cards list
    }
    
    // Fetch remaining employee names from API
    for (const empId of Array.from(employeeIdsToFetch)) {
      try {
        let employeeItem: any = null;
        
        // Try Employees list first
        if (employeesListId) {
          try {
            employeeItem = await this.makeGraphRequest(
              `sites/${siteId}/lists/${employeesListId}/items/${empId}?$expand=fields`
            );
          } catch (error) {
            // Try Access Cards list if Employees list fails
          }
        }
        
        // Try Access Cards list if Employees list failed or doesn't exist
        if (!employeeItem) {
          try {
            const accessCardsListId = await this.getListId('Access Cards');
            employeeItem = await this.makeGraphRequest(
              `sites/${siteId}/lists/${accessCardsListId}/items/${empId}?$expand=fields`
            );
            
            // If it's an Access Card, extract Employee field from it
            if (employeeItem.fields?.AccessCardNo && employeeItem.fields?.Employee) {
              const empField = employeeItem.fields.Employee;
              if (typeof empField === 'object' && empField.displayName) {
                employeeNameCache.set(empId, empField.displayName);
                continue;
              } else if (typeof empField === 'string' && !empField.match(/^HPH\s?\d+/)) {
                employeeNameCache.set(empId, empField);
                continue;
              }
            }
          } catch (error) {
            continue;
          }
        }
        
        // Extract employee name from the item
        const employeeName = this.extractEmployeeName(employeeItem);
        if (employeeName) {
          employeeNameCache.set(empId, employeeName);
        }
      } catch (error: any) {
        console.error(`Failed to fetch employee name for ID ${empId}:`, error.message);
      }
    }
    
    // Populate Employee field in all records
    records.forEach((record: any) => {
      if (record.EmployeeLookupId != null) {
        const employeeId = typeof record.EmployeeLookupId === 'string' 
          ? parseInt(record.EmployeeLookupId, 10) 
          : record.EmployeeLookupId;
        
        if (!isNaN(employeeId) && employeeId > 0) {
          const employeeName = employeeNameCache.get(employeeId);
          if (employeeName) {
            record['Employee'] = employeeName;
            record['EmployeeName'] = employeeName;
          } else {
            record['Employee'] = `[ID: ${employeeId}]`;
          }
        }
      }
    });
  }

  /**
   * Resolve Assignee names for Assets
   */
  private async resolveAssigneeNames(records: any[], cachedEmployees?: any[]): Promise<void> {
    const userIdsToFetch = new Set<string>();
    records.forEach((record: any) => {
      if (record.field_2LookupId != null) {
        userIdsToFetch.add(String(record.field_2LookupId));
      }
    });
    
    if (userIdsToFetch.size === 0) return;
    
    const userNameCache = new Map<string, string>();
    
    // Fetch user names
    for (const userId of Array.from(userIdsToFetch)) {
      try {
        // First check if field_2 contains the user object directly
        const recordWithField2 = records.find((r: any) => r.field_2LookupId === userId);
        if (recordWithField2?.field_2 && typeof recordWithField2.field_2 === 'object') {
          const userName = recordWithField2.field_2.displayName || 
                         recordWithField2.field_2.Title ||
                         recordWithField2.field_2.userPrincipalName;
          if (userName) {
            userNameCache.set(userId, userName);
            continue;
          }
        }
        
        // Try to find in cached employees list (if field_2LookupId is a SharePoint list item ID)
        if (cachedEmployees && cachedEmployees.length > 0) {
          const employeeId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
          if (!isNaN(employeeId) && employeeId > 0) {
            const cachedEmployee = cachedEmployees.find((emp: any) => {
              const cachedId = typeof emp.Id === 'string' ? parseInt(emp.Id, 10) : emp.Id;
              return cachedId === employeeId;
            });
            
            if (cachedEmployee) {
              const employeeName = cachedEmployee.Employee || 
                                  cachedEmployee.EmployeeName || 
                                  cachedEmployee.Title ||
                                  cachedEmployee.displayName;
              if (employeeName) {
                userNameCache.set(userId, employeeName);
                continue;
              }
            }
          }
        }
        
        // Only try Graph API if userId looks like a GUID (Microsoft Graph user ID format)
        // GUIDs are typically 36 characters with dashes: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
        const isGuidFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
        if (isGuidFormat) {
          try {
            const userInfo = await this.makeGraphRequest(`users/${userId}`);
            const userName = userInfo.displayName || userInfo.userPrincipalName || userInfo.mail;
            if (userName) {
              userNameCache.set(userId, userName);
              continue;
            }
          } catch (graphError: any) {
            // If Graph API fails, it's likely not a valid user ID
            console.error(`Failed to fetch user name for ID ${userId} from Graph API:`, graphError.message);
          }
        }
      } catch (error: any) {
        console.error(`Failed to fetch user name for ID ${userId}:`, error.message);
      }
    }
    
    // Populate Assignee field in all records
    records.forEach((record: any) => {
      if (record.field_2LookupId != null) {
        const userId = String(record.field_2LookupId);
        
        // First check if field_2 contains the user object directly
        if (record.field_2 && typeof record.field_2 === 'object') {
          const userName = record.field_2.displayName || 
                         record.field_2.Title || 
                         record.field_2.userPrincipalName ||
                         record.field_2.email;
          if (userName) {
            record['Assignee'] = userName;
            record['AssigneeName'] = userName;
            return;
          }
        }
        
        // Use cached user name
        const userName = userNameCache.get(userId);
        if (userName) {
          record['Assignee'] = userName;
          record['AssigneeName'] = userName;
        } else {
          record['Assignee'] = `[ID: ${userId}]`;
        }
      }
    });
  }

  /**
   * Insert a record into a SharePoint list
   */
  async insertRecord(listName: string, fields: ListItem): Promise<any> {
    const listId = await this.getListId(listName);
    const siteId = await this.getSiteId();
    
    const itemData = {
      fields: fields,
    };

    const response = await this.makeGraphRequest(
      `sites/${siteId}/lists/${listId}/items`,
      {
        method: 'POST',
        body: JSON.stringify(itemData),
      }
    );

    return {
      d: {
        ...response,
        fields: response.fields || {},
      },
    };
  }

  /**
   * Get all items from a list
   */
  async getRecords(listName: string, cachedEmployees?: any[]): Promise<any[]> {
    const listId = await this.getListId(listName);
    const siteId = await this.getSiteId();
    
    // Get all items with fields - fields are included by default in Graph API
    // Try without $select first, as it might limit fields returned
    const response = await this.makeGraphRequest(
      `sites/${siteId}/lists/${listId}/items?$expand=fields`
    );
    const items = response.value || [];
    
    // Transform to flat structure - fields are already expanded
    const records = items.map((item: any) => {
      // Fields might be in item.fields or directly in item
      const fields = item.fields || {};
      const record: any = {
        Id: item.id,
        ...fields,
      };
      
      // Debug: Log structure for first item
      if (items.indexOf(item) === 0) {
        console.log(`[getRecords] ${listName} - Raw item:`, JSON.stringify(item, null, 2));
        console.log(`[getRecords] ${listName} - Fields object:`, JSON.stringify(fields, null, 2));
        console.log(`[getRecords] ${listName} - Final record keys:`, Object.keys(record));
        console.log(`[getRecords] ${listName} - Record sample (first 3 fields):`, 
          Object.keys(record).slice(0, 3).map(key => `${key}: ${record[key]}`).join(', '));
      }
      
      return record;
    });
    
    // Resolve lookup fields
    if (listName === 'Access Cards' && records.length > 0) {
      await this.resolveEmployeeNames(records, siteId, cachedEmployees);
    }
    
    if (listName === 'Assets' && records.length > 0) {
      await this.resolveAssigneeNames(records, cachedEmployees);
    }
    
    return records;
  }

  /**
   * Update a record in a SharePoint list
   */
  async updateRecord(
    listName: string,
    itemId: number | string,
    fields: ListItem
  ): Promise<any> {
    const listId = await this.getListId(listName);
    const siteId = await this.getSiteId();

    return await this.makeGraphRequest(
      `sites/${siteId}/lists/${listId}/items/${itemId}/fields`,
      {
        method: 'PATCH',
        body: JSON.stringify(fields),
      }
    );
  }

  /**
   * Delete a record from a SharePoint list
   */
  async deleteRecord(listName: string, itemId: number | string): Promise<void> {
    const listId = await this.getListId(listName);
    const siteId = await this.getSiteId();

    await this.makeGraphRequest(
      `sites/${siteId}/lists/${listId}/items/${itemId}`,
      {
        method: 'DELETE',
      }
    );
  }

  /**
   * Get current user information
   */
  async getCurrentUser(): Promise<{
    id: string;
    displayName: string;
    userPrincipalName: string;
    mail: string;
    jobTitle?: string;
    officeLocation?: string;
  }> {
    const response = await this.makeGraphRequest('me');
    return {
      id: response.id,
      displayName: response.displayName,
      userPrincipalName: response.userPrincipalName,
      mail: response.mail || response.userPrincipalName,
      jobTitle: response.jobTitle,
      officeLocation: response.officeLocation,
    };
  }

  /**
   * Check if current user is an admin
   */
  async isCurrentUserAdmin(): Promise<{
    isAdmin: boolean;
    roles: string[];
  }> {
    try {
      const response = await this.makeGraphRequest('me/memberOf');
      const groups = response.value || [];
      
      const adminRoleTemplateIds = [
        '62e90394-69f5-4237-9190-012177145e10', // Global Administrator
        'f28a1f50-f6e7-4571-818b-6a12f2af6b6c', // SharePoint Administrator
        'b0f54661-2d74-4c50-afa3-1ec803f12efe', // Exchange Administrator
        '29232cdf-9323-42fd-ade2-1d097af3e4de', // User Administrator
      ];

      const adminRoles: string[] = [];
      let isAdmin = false;

      for (const group of groups) {
        if (group['@odata.type'] === '#microsoft.graph.directoryRole') {
          const roleTemplateId = group.roleTemplateId;
          if (adminRoleTemplateIds.includes(roleTemplateId)) {
            isAdmin = true;
            adminRoles.push(group.displayName || 'Unknown Role');
          }
        }
      }

      return {
        isAdmin,
        roles: adminRoles,
      };
    } catch (error: any) {
      console.error('Error checking admin status:', error);
      return {
        isAdmin: false,
        roles: [],
      };
    }
  }

  /**
   * Get all users in the organization
   */
  async getAllUsers(): Promise<Array<{
    id: string;
    displayName: string;
    userPrincipalName: string;
    mail: string;
    jobTitle?: string;
    officeLocation?: string;
    department?: string;
  }>> {
    try {
      // Fetch all users from Microsoft Graph API with pagination
      // Using $select to get only needed fields for better performance
      const allUsers: any[] = [];
      let nextLink: string | null = null;
      let pageCount = 0;
      const maxPages = 50; // Limit to prevent infinite loops
      
      do {
        const endpoint = nextLink 
          ? nextLink.replace('https://graph.microsoft.com/v1.0/', '') // Remove base URL if present
          : `users?$select=id,displayName,userPrincipalName,mail,jobTitle,officeLocation,department&$top=999`;
        
        const response = await this.makeGraphRequest(endpoint);
        
        if (response.value && response.value.length > 0) {
          const users = response.value.map((user: any) => ({
            id: user.id,
            displayName: user.displayName || '',
            userPrincipalName: user.userPrincipalName || '',
            mail: user.mail || user.userPrincipalName || '',
            jobTitle: user.jobTitle,
            officeLocation: user.officeLocation,
            department: user.department,
          }));
          
          allUsers.push(...users);
        }
        
        // Check for next page
        nextLink = response['@odata.nextLink'] || null;
        pageCount++;
        
        // Safety check to prevent infinite loops
        if (pageCount >= maxPages) {
          break;
        }
      } while (nextLink);
      
      return allUsers;
    } catch (error: any) {
      console.error('Error getting all users:', error);
      const errorMessage = error.message || '';
      if (
        errorMessage.includes('403') || 
        errorMessage.includes('Forbidden') ||
        errorMessage.includes('Insufficient') ||
        errorMessage.includes('Directory.Read') ||
        errorMessage.includes('User.Read.All')
      ) {
        return [];
      }
      return [];
    }
  }

  /**
   * Get list of admin users
   */
  async getAdminUsers(): Promise<Array<{
    id: string;
    displayName: string;
    userPrincipalName: string;
    mail: string;
    roles: string[];
  }>> {
    try {
      const rolesResponse = await this.makeGraphRequest('directoryRoles');
      const globalAdminRole = rolesResponse.value?.find(
        (role: any) => role.roleTemplateId === '62e90394-69f5-4237-9190-012177145e10'
      );

      if (!globalAdminRole) {
        return [];
      }

      const membersResponse = await this.makeGraphRequest(
        `directoryRoles/${globalAdminRole.id}/members`
      );

      const admins = [];
      for (const member of membersResponse.value || []) {
        if (member['@odata.type'] === '#microsoft.graph.user') {
          admins.push({
            id: member.id,
            displayName: member.displayName,
            userPrincipalName: member.userPrincipalName,
            mail: member.mail || member.userPrincipalName,
            roles: ['Global Administrator'],
          });
        }
      }

      return admins;
    } catch (error: any) {
      console.error('Error getting admin users:', error);
      const errorMessage = error.message || '';
      if (
        errorMessage.includes('403') || 
        errorMessage.includes('Forbidden') ||
        errorMessage.includes('Insufficient') ||
        errorMessage.includes('Directory.Read') ||
        errorMessage.includes('User.Read.All')
      ) {
        return [];
      }
      return [];
    }
  }

  /**
   * Get current user info with admin status
   */
  async getCurrentUserWithAdminStatus(): Promise<{
    user: {
      id: string;
      displayName: string;
      userPrincipalName: string;
      mail: string;
      jobTitle?: string;
      officeLocation?: string;
    };
    isAdmin: boolean;
    roles: string[];
  }> {
    const [user, adminStatus] = await Promise.all([
      this.getCurrentUser(),
      this.isCurrentUserAdmin(),
    ]);

    return {
      user,
      ...adminStatus,
    };
  }
}

export default SharePointService;
