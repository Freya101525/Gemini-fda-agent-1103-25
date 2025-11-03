import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// Declare pdfjs and Tesseract on the window object for TypeScript
declare global {
    interface Window {
        pdfjsLib: any;
        Tesseract: any;
    }
}


const App = () => {
    // --- STATE MANAGEMENT ---
    const [activeTab, setActiveTab] = useState('ingestion');
    const [ocrStatus, setOcrStatus] = useState('');


    const REGULATORY_ORCHESTRATOR_PROMPT = `
You are an expert regulatory reviewer for medical devices. Your job is to:
- Read guidance/regulations in Traditional Chinese and/or English.
- Extract granular, testable requirements with traceability to the guidance (IDs, sections, references).
- Evaluate dossier/evidence completeness, highlight gaps, risks, and remediation steps.
- Produce structured JSON outputs plus a human-friendly summary and checklist.
- Preserve bilingual fidelity where present (Traditional Chinese + English labels).
- Be precise; avoid hallucinations; cite exact lines/sections, page numbers, or figure labels when available.

General rules:
- Do not invent missing data. Mark as Missing and propose specific, minimal compliant evidence.
- Keep outputs schema-valid JSON where requested. Provide short Markdown summary only where asked.
- When OCR text is noisy, note uncertainties and recommend page-level re-scan.
- No chain-of-thought. Provide only final reasoning succinctly as “rationale” fields when required.
`;

    // FIX: Renamed 'default_model' to 'model' and 'max_output_tokens' to 'maxOutputTokens' for consistency and to fix errors.
    const initialAgents = [
        {
          name: 'RequirementExtractor',
          description: 'Extracts structured requirements from the guidance.',
          model: 'gemini-2.5-flash',
          params: { temperature: 0.2, maxOutputTokens: 2000 },
          system_prompt: `${REGULATORY_ORCHESTRATOR_PROMPT}\nROLE: Requirement Extractor.\nTASK: Extract all explicit and implicit requirements from the provided guidance into a clean, deduplicated list with unique IDs.\nOUTPUT: JSON with fields: items[{id, title, requirement, category, references, priority}].\nSTYLE: concise, complete, bilingual labels if possible (Traditional Chinese and English).`
        },
        {
          name: 'GapAnalyzer',
          description: 'Compares provided dossier/evidence against extracted requirements to find gaps.',
          model: 'gemini-2.5-pro',
          params: { temperature: 0.2, maxOutputTokens: 2000 },
          system_prompt: `${REGULATORY_ORCHESTRATOR_PROMPT}\nROLE: Gap Analyzer.\nINPUTS: requirements JSON and dossier/evidence text.\nTASK: For each requirement, classify coverage (Covered/Partial/Missing), cite evidence snippets, and list missing evidence.\nOUTPUT: JSON with fields: coverage[{req_id, status, evidence_snippets[], missing_evidence[], risk_level, remediation_suggestions[]}].`
        },
        {
          name: 'EvidenceMapper',
          description: 'Maps documents/pages to requirements with traceability links.',
          model: 'gemini-2.5-flash',
          params: { temperature: 0.2, maxOutputTokens: 1800 },
          system_prompt: `${REGULATORY_ORCHESTRATOR_PROMPT}\nROLE: Evidence Mapper.\nTASK: Build a bidirectional traceability matrix between requirements and provided document sections/pages.\nOUTPUT: JSON with fields: trace[{req_id, doc_id, page, snippet, confidence}].`
        },
        {
          name: 'ChecklistFormatter',
          description: 'Produces a reviewer-ready checklist and summary.',
          model: 'gemini-2.5-flash',
          params: { temperature: 0.1, maxOutputTokens: 2200 },
          system_prompt: `${REGULATORY_ORCHESTRATOR_PROMPT}\nROLE: Checklist Formatter.\nTASK: Generate a final checklist table and executive summary (TC/EN bilingual section headers).\nOUTPUT: JSON {summary, checklist_markdown, key_risks[], next_actions[], glossary[]} and Markdown preview.`
        }
    ];

    const initialGuidanceText = `以下為依您提供之審查檢核表（繁體中文）所建置的 FDA/TFDA 醫療器材審查表（Markdown）。每一列的「狀態」欄位可勾選：AGREE / DISAGREE / NA，並保留「證據/連結」與「備註」欄位供上傳與紀錄。

說明

狀態填寫方式：□ AGREE □ DISAGREE □ NA（擇一勾選）
可於「證據/連結」欄附上檔案位置、雲端資料夾或公開資料庫連結（如 510(k) 檢索、QMS 證書）
表格已按原清單項次分節呈現，便於內外部審核追蹤
一、本案及相關案件背景說明

項次	審查重點	狀態	證據/連結	備註
1-1	符合優先審查之佐證文件/資料（二擇一）	□ AGREE □ DISAGREE □ NA		
1-2	列舉相關背景資料	□ AGREE □ DISAGREE □ NA		
二、是否檢附本部核准類似品之相關資料

項次	審查重點	狀態	證據/連結	備註
2-1	本部核准類似品資料（許可證字號、仿單/標籤核定本影本或比較表）	□ AGREE □ DISAGREE □ NA		若具此資料，2-2、2-3得免附
2-2	學術理論依據與研究報告資料	□ AGREE □ DISAGREE □ NA		
2-3	臨床試驗報告	□ AGREE □ DISAGREE □ NA		
2-4	是否屬無類似品醫療器材	□ AGREE □ DISAGREE □ NA		
三、原廠同一產品不同品名之說明函正本

項次	審查重點	狀態	證據/連結	備註
3-1	說明新舊品為相同產品並註明原許可證字號；附許可證與核定標籤/說明書/包裝影本	□ AGREE □ DISAGREE □ NA		
四、申請書

項次	審查重點	狀態	證據/連結	備註
4-1	申請書中英文繕打並依送審資料詳實填表	□ AGREE □ DISAGREE □ NA		
4-2	各欄位詳填，並加蓋醫療器材商及負責人印鑑	□ AGREE □ DISAGREE □ NA		
4-3	載明中文/英文品名、型號、規格，與製售證明及授權書相符	□ AGREE □ DISAGREE □ NA		
4-4	品名符合核定原則	□ AGREE □ DISAGREE □ NA		
4-5	品名冠商標：檢附商標註冊資料；冠他商名稱/商標：檢附同意函	□ AGREE □ DISAGREE □ NA		
4-6	申請醫療器材商名稱、地址與許可執照相符	□ AGREE □ DISAGREE □ NA		
4-7	製造業者名稱、地址	□ AGREE □ DISAGREE □ NA		
4-8	委託製造：分別列出委託者/受託製造者名稱、地址【Manufactured by A (…) for B (…)】	□ AGREE □ DISAGREE □ NA		
4-9	非同系列名稱之不同型號（以原廠說明書原名為準）須另案辦理	□ AGREE □ DISAGREE □ NA		
`;

    const [workspace, setWorkspace] = useState({
        rawText: initialGuidanceText,
        agents: initialAgents,
        agentsRunConfig: initialAgents,
        runLog: [],
        metrics: { ocr_pages: 0, chars: initialGuidanceText.length, agents_run: 0, latency: 0.0 },
        isRunning: false,
        error: null,
    });
    
    // --- HANDLERS & LOGIC ---

    const handleRunChain = async (baseInput) => {
        setWorkspace(prev => ({ ...prev, isRunning: true, error: null, runLog: [] }));
        let currentInput = baseInput;
        let totalLatency = 0;
        const newRunLog = [];

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            for (const agentConfig of workspace.agentsRunConfig) {
                const startTime = performance.now();
                
                // FIX: Using the explicit chat history format for 'contents' by wrapping the user
                // input in an array. This provides a more robust structure that the API expects,
                // resolving the 'data' field initialization error, especially when chaining prompts.
                const response = await ai.models.generateContent({
                    model: agentConfig.model,
                    contents: [{ role: 'user', parts: [{ text: currentInput }] }],
                    config: {
                        systemInstruction: agentConfig.system_prompt,
                        temperature: agentConfig.params.temperature,
                        maxOutputTokens: agentConfig.params.maxOutputTokens,
                    },
                });
                const endTime = performance.now();
                const latency = (endTime - startTime) / 1000;
                totalLatency += latency;

                const outputText = response.text ?? ''; // Safely handle potentially empty responses
                const logEntry = {
                    agentName: agentConfig.name,
                    model: agentConfig.model,
                    output: outputText,
                    latency: latency.toFixed(2),
                };

                newRunLog.push(logEntry);
                setWorkspace(prev => ({ ...prev, runLog: [...newRunLog] }));
                currentInput = outputText;
            }

        } catch (e) {
            console.error(e);
            setWorkspace(prev => ({ ...prev, error: e.message }));
        } finally {
            setWorkspace(prev => ({
                ...prev,
                isRunning: false,
                metrics: { ...prev.metrics, agents_run: newRunLog.length, latency: totalLatency },
            }));
        }
    };
    
    const handleRunConfigChange = (index, field, value) => {
        const newConfig = [...workspace.agentsRunConfig];
        if (field.startsWith('params.')) {
            const paramKey = field.split('.')[1];
            newConfig[index].params[paramKey] = value;
        } else {
            newConfig[index][field] = value;
        }
        setWorkspace(p => ({...p, agentsRunConfig: newConfig}));
    };

    const handleHandoffEdit = (index, newOutput) => {
        const newRunLog = [...workspace.runLog];
        newRunLog[index].output = newOutput;
        setWorkspace(p => ({...p, runLog: newRunLog}));
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.type === 'application/pdf') {
            await handlePdfUpload(file);
        } else {
            const reader = new FileReader();
            reader.onload = (event) => {
                const text = event.target.result as string;
                setWorkspace(p => ({
                    ...p, 
                    rawText: text,
                    metrics: { ...p.metrics, chars: text.length, ocr_pages: 0 }
                }));
                setActiveTab('agents'); 
            };
            reader.readAsText(file);
        }
    };

    const handlePdfUpload = async (file) => {
        setOcrStatus('Loading PDF...');
        const fileReader = new FileReader();

        fileReader.onload = async () => {
            const typedarray = new Uint8Array(fileReader.result as ArrayBuffer);
            const pdf = await window.pdfjsLib.getDocument(typedarray).promise;
            let fullText = '';
            
            for (let i = 1; i <= pdf.numPages; i++) {
                setOcrStatus(`Rendering page ${i}/${pdf.numPages}...`);
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better OCR
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                await page.render({ canvasContext: context, viewport: viewport }).promise;

                setOcrStatus(`Analyzing page ${i}/${pdf.numPages} with OCR...`);
                const { data: { text } } = await window.Tesseract.recognize(
                    canvas,
                    'chi_tra', // Traditional Chinese
                    { 
                        logger: m => {
                            if (m.status === 'recognizing text') {
                                setOcrStatus(`OCR on page ${i}: ${Math.round(m.progress * 100)}%`);
                            }
                        }
                    }
                );
                fullText += text + '\n\n';
            }
            
            setWorkspace(p => ({
                ...p,
                rawText: fullText,
                metrics: { ...p.metrics, chars: fullText.length, ocr_pages: pdf.numPages }
            }));
            setOcrStatus('');
            setActiveTab('agents');
        };

        fileReader.readAsArrayBuffer(file);
    };
    
    const handleRawTextChange = (newText) => {
        const oldText = workspace.rawText;
        setWorkspace(p => ({
            ...p,
            rawText: newText,
            metrics: { ...p.metrics, chars: newText.length }
        }));

        // Heuristic: If user pastes a large chunk of text, move to the next step.
        // Threshold of 200 characters and must be on the ingestion tab.
        if (activeTab === 'ingestion' && (newText.length - oldText.length) > 200) {
            setActiveTab('agents');
        }
    };

    const downloadResults = () => {
        const exportData = {
            guidance_excerpt: workspace.rawText.substring(0, 1000),
            chain: workspace.runLog.map(({ agentName, model, output }) => ({ agent: agentName, model, output })),
            metrics: workspace.metrics,
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'agent_chain_results.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // --- UI COMPONENTS ---
    
    const tabs = {
        ingestion: { label: '1. Guidance Ingestion', icon: '📥' },
        agents: { label: '2. Agents & Prompts', icon: '🤖' },
        run: { label: '3. Run Chain', icon: '🚀' },
        dashboard: { label: '4. Dashboard', icon: '📊' },
    };
    
    const renderActiveTab = () => {
        switch(activeTab) {
            case 'ingestion': return <TabIngestion />;
            case 'agents': return <TabAgents />;
            case 'run': return <TabRunChain />;
            case 'dashboard': return <TabDashboard />;
            default: return null;
        }
    };

    const TabIngestion = () => (
        <div className="tab-content">
            <h2><span className="icon">{tabs.ingestion.icon}</span> {tabs.ingestion.label}</h2>
            <p>Upload or paste your guidance document. The agentic workflow will begin with this text.</p>
            <div className="ingestion-grid">
                <div className="card">
                    <h3>Upload Guidance</h3>
                    <p>Supported formats: TXT, MD, and PDF (with Traditional Chinese OCR).</p>
                    <input type="file" onChange={handleFileChange} accept=".txt,.md,.pdf" />
                    {ocrStatus && <div className="ocr-status">{ocrStatus}</div>}
                </div>
                <div className="card">
                    <h3>Paste Guidance</h3>
                    <textarea 
                        aria-label="Paste guidance text here"
                        value={workspace.rawText} 
                        onChange={e => handleRawTextChange(e.target.value)}
                        placeholder="Paste guidance text here..."
                    />
                </div>
            </div>
        </div>
    );
    
    const TabAgents = () => (
        <div className="tab-content">
            <h2><span className="icon">{tabs.agents.icon}</span> {tabs.agents.label}</h2>
            <p>Configure the agents that will run in sequence. You can modify their prompts, models, and parameters.</p>
            <div className="agents-container">
            {workspace.agentsRunConfig.map((agent, index) => (
                <details key={index} className="agent-card" open={index < 2}>
                    <summary>
                        <div className="agent-summary-title">
                            <strong>{index + 1}. {agent.name}</strong>
                            <span>{agent.description}</span>
                        </div>
                        <div className="chip">{agent.model}</div>
                    </summary>
                    <div className="agent-config">
                        <div className="form-group-grid">
                            <div className="form-group">
                                <label htmlFor={`model-${index}`}>Model</label>
                                <select 
                                    id={`model-${index}`} 
                                    value={agent.model}
                                    onChange={e => handleRunConfigChange(index, 'model', e.target.value)}
                                >
                                    <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                                    <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label htmlFor={`temp-${index}`}>Temperature: {agent.params.temperature}</label>
                                <input 
                                    type="range" 
                                    id={`temp-${index}`} 
                                    min="0" max="1" step="0.1" 
                                    value={agent.params.temperature}
                                    onChange={e => handleRunConfigChange(index, 'params.temperature', parseFloat(e.target.value))}
                                />
                            </div>
                             {/* FIX: Changed `max_output_tokens` to `maxOutputTokens` to match updated state property. */}
                             <div className="form-group">
                                <label htmlFor={`tokens-${index}`}>Max Tokens</label>
                                <input 
                                    type="number"
                                    id={`tokens-${index}`} 
                                    min="256" max="8192" step="64"
                                    value={agent.params.maxOutputTokens}
                                    onChange={e => handleRunConfigChange(index, 'params.maxOutputTokens', parseInt(e.target.value))}
                                />
                            </div>
                        </div>
                        <div className="form-group">
                            <label htmlFor={`prompt-${index}`}>System Prompt</label>
                            <textarea 
                                id={`prompt-${index}`} 
                                value={agent.system_prompt}
                                onChange={e => handleRunConfigChange(index, 'system_prompt', e.target.value)}
                            />
                        </div>
                    </div>
                </details>
            ))}
            </div>
        </div>
    );

    const TabRunChain = () => {
        const [initialInput, setInitialInput] = useState(workspace.rawText);
        useEffect(() => {
            setInitialInput(workspace.rawText);
        }, [workspace.rawText]);

        return (
        <div className="tab-content">
            <h2><span className="icon">{tabs.run.icon}</span> {tabs.run.label}</h2>
            <p>The text below will be the initial input for the first agent. Press "Run" to start the process.</p>
            <div className="card">
                <div className="form-group">
                    <label>Initial Input to Agent 1</label>
                    <textarea value={initialInput} onChange={e => setInitialInput(e.target.value)} />
                </div>
                <button 
                    onClick={() => handleRunChain(initialInput)} 
                    disabled={workspace.isRunning} 
                    className="button-primary"
                >
                    {workspace.isRunning ? 'Running...' : 'Run Agents Sequentially'}
                </button>
            </div>
            
            {workspace.isRunning && <div className="loader"></div>}
            {workspace.error && <div className="card error-card"><strong>Error:</strong> {workspace.error}</div>}

            <div className="run-log">
                {workspace.runLog.map((log, index) => (
                    <div key={index} className="card run-log-entry">
                        <div className="log-header">
                            <h3>{log.agentName} Output</h3>
                            <div className="chip">{log.model} ({log.latency}s)</div>
                        </div>
                        <textarea 
                            value={log.output}
                            onChange={e => handleHandoffEdit(index, e.target.value)}
                            aria-label={`Output from ${log.agentName}`}
                        />
                        {index < workspace.agentsRunConfig.length - 1 && <div className="handoff-arrow">↓ Handoff to next agent</div>}
                    </div>
                ))}
            </div>

            {workspace.runLog.length > 0 && !workspace.isRunning && (
                <button onClick={downloadResults} className="button-secondary">Download Chain Results (JSON)</button>
            )}
        </div>
        );
    }
    
    const TabDashboard = () => {
        const m = workspace.metrics;
        let score = 0;
        if (m.ocr_pages > 0 || m.chars > 1000) score++;
        if (m.agents_run >= 2) score++;
        if (m.chars > 5000 && m.agents_run >= 4) score++;
        
        const statusMap = {
            0: { label: "Getting Started", color: "var(--warning-color)" },
            1: { label: "Warming Up", color: "#f59e0b" },
            2: { label: "On Track", color: "var(--success-color)" },
            3: { label: "Wow! Pro Level", color: "var(--primary-color)" }
        };
        const { label, color } = statusMap[score];
        
        return (
        <div className="tab-content">
            <h2><span className="icon">{tabs.dashboard.icon}</span> {tabs.dashboard.label}</h2>
            <p>A summary of the latest agentic run.</p>
            <div className="status-banner" style={{ backgroundColor: color }}>
                Status: {label}
            </div>
            <div className="metrics-grid">
                <div className="card metric-card">
                    <h4>Chars Ingested</h4>
                    <p>{m.chars.toLocaleString()}</p>
                </div>
                 <div className="card metric-card">
                    <h4>PDF Pages OCR'd</h4>
                    <p>{m.ocr_pages.toLocaleString()}</p>
                </div>
                <div className="card metric-card">
                    <h4>Agents Run</h4>
                    <p>{m.agents_run}</p>
                </div>
                <div className="card metric-card">
                    <h4>Total Latency</h4>
                    <p>{m.latency.toFixed(2)}s</p>
                </div>
                <div className="card metric-card">
                    <h4>Avg. Latency</h4>
                    <p>{m.agents_run > 0 ? (m.latency / m.agents_run).toFixed(2) : '0.00'}s</p>
                </div>
            </div>
            <div className="card">
                <h3>Run Timeline</h3>
                {workspace.runLog.length > 0 ? (
                <ol className="timeline">
                    {workspace.runLog.map((log, index) => (
                        <li key={index}><strong>{log.agentName}</strong> completed in {log.latency}s</li>
                    ))}
                </ol>
                ) : <p>Run the agent chain to see a timeline.</p>}
            </div>
        </div>
        );
    }
    
    // --- RENDER ---
    return (
        <>
            <style>{STYLES}</style>
            <header className="app-header">
                <h1>Agentic Regulatory Review Workbench</h1>
                <p>An AI-powered system for structured document analysis</p>
            </header>
            <nav className="app-nav">
                {Object.entries(tabs).map(([key, { label, icon }]) => (
                    <button 
                        key={key} 
                        onClick={() => setActiveTab(key)} 
                        className={activeTab === key ? 'active' : ''}
                        aria-pressed={activeTab === key}
                    >
                        <span className="icon">{icon}</span> {label}
                    </button>
                ))}
            </nav>
            <main className="app-main">
                {renderActiveTab()}
            </main>
        </>
    );
};

const STYLES = `
    .app-header {
        background-color: var(--surface-color);
        padding: 1.5rem 2rem;
        border-bottom: 1px solid var(--border-color);
        box-shadow: var(--box-shadow);
    }
    .app-header h1 {
        margin: 0;
        font-size: 1.75rem;
        color: var(--primary-color);
    }
    .app-header p {
        margin: 0.25rem 0 0;
        color: var(--muted-text-color);
    }
    .app-nav {
        display: flex;
        background-color: var(--surface-color);
        padding: 0 2rem;
        border-bottom: 1px solid var(--border-color);
        gap: 0.5rem;
    }
    .app-nav button {
        background: none;
        border: none;
        padding: 1rem 1.5rem;
        cursor: pointer;
        font-size: 1rem;
        font-weight: 500;
        color: var(--muted-text-color);
        border-bottom: 3px solid transparent;
        transition: color 0.2s, border-color 0.2s;
    }
    .app-nav button:hover {
        color: var(--primary-color);
    }
    .app-nav button.active {
        color: var(--primary-color);
        border-bottom-color: var(--primary-color);
    }
    .app-main {
        padding: 2rem;
        flex-grow: 1;
        max-width: 1200px;
        margin: 0 auto;
        width: 100%;
        box-sizing: border-box;
    }
    .tab-content h2 { margin-top: 0; }
    .tab-content .icon { font-size: 1.5rem; vertical-align: middle; margin-right: 0.5rem; }
    
    .card {
        background-color: var(--surface-color);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        padding: 1.5rem;
        margin-bottom: 1.5rem;
        box-shadow: var(--box-shadow);
    }

    textarea, input, select {
        width: 100%;
        padding: 0.75rem;
        border: 1px solid var(--border-color);
        border-radius: calc(var(--border-radius) / 2);
        background-color: var(--background-color);
        color: var(--text-color);
        font-family: inherit;
        font-size: 1rem;
        box-sizing: border-box;
    }
    textarea {
        min-height: 200px;
        resize: vertical;
    }

    .button-primary {
        background-color: var(--primary-color);
        color: white;
        border: none;
        padding: 0.75rem 1.5rem;
        font-size: 1rem;
        font-weight: 600;
        border-radius: var(--border-radius);
        cursor: pointer;
        transition: background-color 0.2s;
    }
    .button-primary:hover:not(:disabled) { background-color: #4338ca; }
    .button-primary:disabled { background-color: #a5b4fc; cursor: not-allowed; }
    
    .button-secondary {
        background-color: transparent;
        color: var(--primary-color);
        border: 1px solid var(--primary-color);
        padding: 0.75rem 1.5rem;
        font-size: 1rem;
        font-weight: 600;
        border-radius: var(--border-radius);
        cursor: pointer;
        transition: background-color 0.2s, color 0.2s;
    }
    .button-secondary:hover { background-color: var(--primary-color); color: white; }

    .ingestion-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; }
    .ocr-status {
        margin-top: 1rem;
        font-weight: 500;
        color: var(--primary-color);
    }


    .agent-card {
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        margin-bottom: 1rem;
        background: var(--surface-color);
    }
    .agent-card summary {
        padding: 1rem 1.5rem;
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 1.1rem;
    }
    .agent-summary-title { display: flex; flex-direction: column; }
    .agent-summary-title span { font-size: 0.9rem; color: var(--muted-text-color); font-weight: normal; }
    .agent-config { padding: 0 1.5rem 1.5rem; }
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; font-weight: 500; margin-bottom: 0.5rem; }
    .form-group-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    
    .chip {
        background-color: var(--background-color);
        color: var(--muted-text-color);
        padding: 0.25rem 0.75rem;
        border-radius: 999px;
        font-size: 0.8rem;
        font-weight: 600;
        border: 1px solid var(--border-color);
    }

    .run-log-entry { border-left: 4px solid var(--primary-color); }
    .log-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .log-header h3 { margin: 0; }
    .handoff-arrow { text-align: center; color: var(--muted-text-color); margin-top: 1rem; font-weight: 500; }

    .loader {
        border: 4px solid #f3f3f3;
        border-top: 4px solid var(--primary-color);
        border-radius: 50%;
        width: 40px;
        height: 40px;
        animation: spin 1s linear infinite;
        margin: 2rem auto;
    }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    .error-card { border-left-color: var(--error-color); color: var(--error-color); }
    
    .status-banner {
        color: white;
        padding: 1rem 1.5rem;
        border-radius: var(--border-radius);
        font-size: 1.25rem;
        font-weight: 600;
        margin-bottom: 1.5rem;
        text-align: center;
    }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1.5rem; margin-bottom: 1.5rem; }
    .metric-card { text-align: center; }
    .metric-card h4 { margin: 0 0 0.5rem; color: var(--muted-text-color); font-weight: 500; }
    .metric-card p { margin: 0; font-size: 2rem; font-weight: 700; color: var(--primary-color); }

    .timeline { list-style: none; padding-left: 0; }
    .timeline li {
        position: relative;
        padding: 0.5rem 0 0.5rem 1.5rem;
        border-left: 2px solid var(--border-color);
    }
    .timeline li::before {
        content: '';
        position: absolute;
        left: -7px;
        top: 1rem;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background-color: var(--primary-color);
    }
`;

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);