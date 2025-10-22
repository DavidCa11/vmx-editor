import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as nls from 'vscode-nls';


const localize = nls.config({ messageFormat: nls.MessageFormat.file })();




function getLanguage(): 'fr' | 'en' {
  return vscode.env.language.startsWith('fr') ? 'fr' : 'en';
}

function loadJson(fileName: string): any {
  const lang = getLanguage();
  const filePath = path.join(__dirname, '..', 'data', `${fileName}.${lang}.json`);

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data;
  } catch (err) {vscode.window.showErrorMessage(localize('vmxEditor.LoadError', "Failed to load {0}", fileName));
  return []; }

  //return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}


const completionData: CompletionEntry[] = loadJson('completionData') as CompletionEntry[];
const vmxBlocks: any = loadJson('vmxBlocks');


type CompletionEntry = {
  label: string;
  detail ?: string;
  detailKey?: string;
  insertText?: string;
  insertTextKey?: string;
  documentation ?: string;
  kind?: number;
  type?: 'string' | 'number' | 'boolean' | 'enum';
  enumValues?: string[];
};


function resolveLocalized(defaultText?: string, key?: string, ...args: any[]) {
  if (key) return localize(key, defaultText ?? '', ...args);
  return defaultText ?? '';
}


function isoTimestamp(): string {
  return new Date().toISOString();
}

function isVMXFile(uri: vscode.Uri | undefined): boolean {
  return !!uri && uri.fsPath.toLowerCase().endsWith('.vmx');
}

function ensureDirExists(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}


export function activate(context: vscode.ExtensionContext) {
  
  const bundlePath = path.join(context.extensionPath, 'i18n', `messages.${getLanguage()}.json`);
  console.log('[vmx] extensionPath:', context.extensionPath);
  console.log('[vmx] checking i18n file at', bundlePath, 'exists=', fs.existsSync(bundlePath));
  // si tu appelles loadMessageBundle, logue aussi le filename passé


  console.log(localize('vmxEditor.ExtensionActivated', "VMX Editor extension activated."));
  
  const vmxSelector: vscode.DocumentSelector = { language: 'vmx', scheme: 'file' };

  const diagnostics = vscode.languages.createDiagnosticCollection('vmx');
  context.subscriptions.push(diagnostics);

  


  

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.languageId === 'vmx') {
        const diags = validateVMXDocument(doc);
        diagnostics.set(doc.uri, diags);
      }
    })
  );

  
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === 'vmx') {
        const diags = validateVMXDocument(e.document);
        diagnostics.set(e.document.uri, diags);
      }
    })
  );


  const insertTimestampCmd = vscode.commands.registerCommand('vmxEditor.InsertTimeStamp', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'vmx') {
      vscode.window.showInformationMessage(localize('vmxEditor.OpenForTimeStamp', "Open a .vmx file to insert a timestamp."));
      return;
    }
    const ts = isoTimestamp();
   
    await editor.insertSnippet(
        new vscode.SnippetString(`${localize('vmxEditor.ModifiedOn', "# Modified on")} ${ts}\n`),
        editor.selection.active
    );

  
  });
  context.subscriptions.push(insertTimestampCmd);

  function loadVmxBlocks(context: vscode.ExtensionContext): Record<string, string> {
    const lang = getLanguage();
    const rel = path.join('data', `vmxBlocks.${lang}.json`);
    const full = path.join(context.extensionPath, rel);
    try {
      const raw = fs.readFileSync(full, 'utf8');
      return JSON.parse(raw) as Record<string, string>;
    } catch (err) {
      console.error(localize('vmxEditor.lLoadBlocksFail', "Failed to load VMX blocks {0}"), '${full}, err');
      vscode.window.showErrorMessage(localize('vmxEditor.LoadBlocksFail', "Failed to load VMX blocks"));
      return {};
    }
  }

  //export
 function registerInsertBlockCommand(context: vscode.ExtensionContext) {
  const vmxBlocks = loadVmxBlocks(context);

  const disposable = vscode.commands.registerCommand(localize('vmxEditor.InsertBlock',"Insert configuration block"), async () => {
    const keys = Object.keys(vmxBlocks);
    if (keys.length === 0) {
      vscode.window.showInformationMessage(localize('vmxEditor.NoBlocks', "No VMX blocks available"));
      return;
    }

    // Préparer les éléments QuickPick ; affiche le label et éventuellement un détail localisé
    const items: vscode.QuickPickItem[] = keys.map(k => ({
      label: k,
      description: undefined,
      detail: undefined
    }));

    const chosen = await vscode.window.showQuickPick(items, {
      placeHolder: localize('vmxEditor.SelectBlockPlaceHolder', "Select a VMX block to insert")
    });

    if (!chosen) return;
      const blockKey = chosen.label;
      const blockContent = vmxBlocks[blockKey];
      if (!blockContent) {
        vscode.window.showErrorMessage(localize('vmxEditor.BlockNotFound', "Selected block not found: {0}", blockKey));
        return;
      }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage(localize('vmxEditor.OpenVmxFirst', "Please open a .vmx file first."));
      return;
    }

    try {
      // Optionnel : créer une sauvegarde avant modification
      await createBackupIfNeeded(editor.document);

      // Insérer le bloc à la position courante (ou au curseur)
      await editor.insertSnippet(new vscode.SnippetString(blockContent), editor.selection.active);

      // Message de confirmation localisé (avec nom du bloc)
      vscode.window.showInformationMessage(localize('vmxEditor.BlockInserted', "Block inserted: {0}", blockKey));
    } catch (err) {
      console.error(localize('vmxEditor.eInsertFail', "Failed to insert block {0}"), err);
      vscode.window.showErrorMessage(localize('vmxEditor.InsertFail', "Failed to insert block"));
    }
  });

  context.subscriptions.push(disposable);
}





// Exemple simple de sauvegarde de secours (backup) avant modification
async function createBackupIfNeeded(doc: vscode.TextDocument) {
  try {
    if (doc.isUntitled) return;
    const backupDir = path.join(path.dirname(doc.uri.fsPath), '.vmx-backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.basename(doc.uri.fsPath);
    const backupPath = path.join(backupDir, `${base}.${ts}.bak`);
    fs.writeFileSync(backupPath, doc.getText(), 'utf8');
    // Optionnel : log dans output channel ou stockage minimal
  } catch (err) {console.warn(localize('vmxEditor.BackupFailed',"Backup creation failed: {0}"), err);
  }
}



  const insertBlockCmd = vscode.commands.registerCommand('vmxEditor.InsertBlock', async () => {   
    const keys = Object.keys(vmxBlocks);
    const selected = await vscode.window.showQuickPick(keys, {
      placeHolder: localize('vmxEditor.SelectBlockPlaceHolder', "Select a VMX block to insert")
  });

  if (!selected) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage(localize('vmxEditor.OpenVmxFirst', "Please open a .vmx file first."));
      return;
    }

    const block = vmxBlocks[selected];
    await editor.insertSnippet(new vscode.SnippetString(block));
    vscode.window.showInformationMessage(localize('vmxEditor.BlockInserted', "Block inserted: {0}", selected));
});


context.subscriptions.push(insertBlockCmd); 



  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument((e) => {
      const doc = e.document;
      if (!isVMXFile(doc.uri)) {return; }

      try {
        const filePath = doc.uri.fsPath;
        const workspaceBackupDir = path.join(path.dirname(filePath), '.vmx-backups');
        ensureDirExists(workspaceBackupDir);

        // Create a timestamped backup copy
        const ts = isoTimestamp().replace(/[:.]/g, '-');
        const baseName = path.basename(filePath);
        const backupName = `${baseName}.${ts}.bak`;
        const backupPath = path.join(workspaceBackupDir, backupName);

        // Write existing content to backup file synchronously before save
        fs.writeFileSync(backupPath, doc.getText(), { encoding: 'utf8' });

        // Insert a top-of-file comment indicating backup (performed via workspace edit)
        //const comment = `# Backup crée ${isoTimestamp()} (backup: .vmx-backups/${backupName})\n`;
        const comment = `${localize('vmxEditor.BackupCreated', "# Backup created")} ${isoTimestamp()} (${localize('vmxEditor.BackupFile', "backup")}: .vmx-backups/${backupName})\n`;

        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, new vscode.Position(0, 0), comment);
        e.waitUntil(vscode.workspace.applyEdit(edit));
      } catch (err) {
        // Non-fatal: log and continue
        //console.error('VMX Editor backup erreur:', err);
        console.error(localize('vmxEditor.BackupError', "VMX Editor backup error: {0}"), err);
      }
    })
  );


  for (const doc of vscode.workspace.textDocuments) {
    if (doc.languageId === 'vmx') {
      const diags = validateVMXDocument(doc);
      diagnostics.set(doc.uri, diags);
    }
  }

  //console.log('VMX Editor extension activated');
  console.log(localize('vmxEditor.ExtensionActivated', "VMX Editor extension activated"));

  // Register completion provider and add to subscriptions so it is disposed on deactivate
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    vmxSelector,
    {
      provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
        const linePrefix = document.lineAt(position).text.substr(0, position.character);
        const completions: vscode.CompletionItem[] = [];

        const data: CompletionEntry[] = completionData ?? [];

        for (const entry of data) {
          if (!entry || !entry.label) continue;
          const item = new vscode.CompletionItem(entry.label, entry.kind ?? vscode.CompletionItemKind.Property);
          item.detail = resolveLocalized(entry.detail, entry.detailKey);
          if (entry.documentation) item.documentation = new vscode.MarkdownString(entry.documentation);

          switch (entry.type) {
            case 'boolean':
              item.insertText = new vscode.SnippetString(`${entry.label} = "${'${1|TRUE,FALSE|}'}"`);
              item.kind = vscode.CompletionItemKind.Enum;
              break;
            case 'number':
              item.insertText = new vscode.SnippetString(`${entry.label} = "${'${1:4096}'}"`);
              item.kind = vscode.CompletionItemKind.Constant;
              break;
            case 'enum':
              {
                const vals = (entry.enumValues || []).join(',');
                const snippet = vals ? `${entry.label} = "${'${1|' + vals + '|}'}"` : `${entry.label} = "${'${1:value}'}"`;
                item.insertText = new vscode.SnippetString(snippet);
                item.kind = vscode.CompletionItemKind.Enum;
              }
              break;
            default:
              {
                const resolvedInsert = resolveLocalized(entry.insertText, entry.insertTextKey) || entry.insertText;
                item.insertText = new vscode.SnippetString(resolvedInsert ?? `${entry.label} = "${'${1:value}'}"`);
                item.kind = vscode.CompletionItemKind.Property;
              }
          }

          item.filterText = entry.label;
          item.sortText = entry.label;
          completions.push(item);
        }

        return completions;
      },
      resolveCompletionItem(item: vscode.CompletionItem) { return item; }
    }, '.', ' ', '=', '"'
  );

  context.subscriptions.push(completionProvider);
}


function validateVMXDocument(document: vscode.TextDocument): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];

  for (let i = 0; i < document.lineCount; i++) {
    const line = document.lineAt(i);
    const raw = line.text.replace(/\r/g, '').trim();
    if (!raw || raw.startsWith('#')) {continue;}

	const withoutComment = raw.replace(/#.*$/, '').trim();
	const kvMatch=withoutComment.match(/^([a-zA-Z0-9_.:\-]+)\s*=\s*"([^"]*)"$/);
	if (!kvMatch) {
		//dianostic pour syntaxe invalide
			const typeError = localize('vmxEditor.InvalidSyntax', "Invalid Syntax. Expected format: key = \"value\"");
			const start = line.firstNonWhitespaceCharacterIndex;
			const range = new vscode.Range(i, start, i, line.text.length);
    		const diag = new vscode.Diagnostic(range, typeError, vscode.DiagnosticSeverity.Warning);
			diagnostics.push(diag);
		continue;
	}
	
	const key = kvMatch[1];
	const value = kvMatch[2];

	const typeError = validateLineType(key, value);
	if (typeError) {
		const start = line.text.indexOf(key);
    	const valueStart = line.text.indexOf('"', start);
    	const range = new vscode.Range(i, valueStart + 1, i, valueStart + 1 + value.length);
    	const diag = new vscode.Diagnostic(range, typeError, vscode.DiagnosticSeverity.Warning);
    	diagnostics.push(diag);
	}   
  } return diagnostics;
}

function validateLineType(key: string, value: string): string | null {
  const entry = completionData.find(e => e.label === key);
  if (!entry || !entry.type) {return null; }
  if (entry.type === 'boolean' && !/^(TRUE|FALSE)$/i.test(value)) {return localize('vmxEditor.BooleanExpected',"Boolean value expected: TRUE or FALSE"); }
  if (entry.type === 'number' && !/^\d+$/.test(value)) {return localize('vmxEditor.NumberExpected',"Numeric value expected");}
  if (entry.type === 'enum' && entry.enumValues && !entry.enumValues.includes(value)) {return localize('vmxEditor.ValueExpected', "Value expected: {0}", entry.enumValues.join(','));}
  return null;
}


export function deactivate() {
  //console.log('VMX Editor extension deactivated');
  console.log(localize('vmxEditor.ExtensionDeactivated', "VMX Editor extension deactivated"));
}