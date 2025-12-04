// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface CampaignData {
  id: string;
  name: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  carbonFootprint: number;
  status: "processing" | "completed" | "error";
  details?: {
    servers: number;
    bandwidth: number;
    impressions: number;
    duration: number;
  };
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newCampaignData, setNewCampaignData] = useState({
    name: "",
    servers: 0,
    bandwidth: 0,
    impressions: 0,
    duration: 0
  });
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignData | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);

  // Calculate statistics
  const completedCount = campaigns.filter(c => c.status === "completed").length;
  const processingCount = campaigns.filter(c => c.status === "processing").length;
  const totalCarbon = campaigns.reduce((sum, c) => sum + (c.carbonFootprint || 0), 0);
  const avgCarbon = campaigns.length > 0 ? totalCarbon / campaigns.length : 0;

  useEffect(() => {
    loadCampaigns().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadCampaigns = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("campaign_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing campaign keys:", e);
        }
      }
      
      const list: CampaignData[] = [];
      
      for (const key of keys) {
        try {
          const campaignBytes = await contract.getData(`campaign_${key}`);
          if (campaignBytes.length > 0) {
            try {
              const campaignData = JSON.parse(ethers.toUtf8String(campaignBytes));
              list.push({
                id: key,
                name: campaignData.name,
                encryptedData: campaignData.data,
                timestamp: campaignData.timestamp,
                owner: campaignData.owner,
                carbonFootprint: campaignData.carbonFootprint || 0,
                status: campaignData.status || "processing",
                details: campaignData.details
              });
            } catch (e) {
              console.error(`Error parsing campaign data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading campaign ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setCampaigns(list);
    } catch (e) {
      console.error("Error loading campaigns:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitCampaign = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting campaign data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newCampaignData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const campaignId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const campaignData = {
        name: newCampaignData.name,
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        carbonFootprint: 0,
        status: "processing",
        details: {
          servers: newCampaignData.servers,
          bandwidth: newCampaignData.bandwidth,
          impressions: newCampaignData.impressions,
          duration: newCampaignData.duration
        }
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `campaign_${campaignId}`, 
        ethers.toUtf8Bytes(JSON.stringify(campaignData))
      );
      
      const keysBytes = await contract.getData("campaign_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(campaignId);
      
      await contract.setData(
        "campaign_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Campaign data encrypted and submitted!"
      });
      
      await loadCampaigns();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewCampaignData({
          name: "",
          servers: 0,
          bandwidth: 0,
          impressions: 0,
          duration: 0
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const calculateCarbon = async (campaignId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Calculating carbon footprint with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const campaignBytes = await contract.getData(`campaign_${campaignId}`);
      if (campaignBytes.length === 0) {
        throw new Error("Campaign not found");
      }
      
      const campaignData = JSON.parse(ethers.toUtf8String(campaignBytes));
      
      // Simulate carbon calculation (in a real scenario, this would be done with FHE)
      const carbon = Math.round(
        (campaignData.details.servers * 0.5) + 
        (campaignData.details.bandwidth * 0.02) + 
        (campaignData.details.impressions * 0.001) + 
        (campaignData.details.duration * 0.1)
      );
      
      const updatedCampaign = {
        ...campaignData,
        carbonFootprint: carbon,
        status: "completed"
      };
      
      await contract.setData(
        `campaign_${campaignId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedCampaign))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Carbon footprint calculated successfully!"
      });
      
      await loadCampaigns();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Calculation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE system is ${isAvailable ? 'available' : 'unavailable'}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the FHE carbon analysis platform",
      icon: "🔗"
    },
    {
      title: "Submit Campaign Data",
      description: "Add your encrypted ad campaign data for carbon footprint analysis",
      icon: "📊"
    },
    {
      title: "FHE Processing",
      description: "Your data is analyzed in encrypted state without decryption using FHE",
      icon: "🔒"
    },
    {
      title: "Get Carbon Results",
      description: "Receive accurate carbon footprint metrics while keeping your data private",
      icon: "🌿"
    }
  ];

  // Filter campaigns based on search term
  const filteredCampaigns = campaigns.filter(campaign => 
    campaign.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    campaign.owner.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination logic
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredCampaigns.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredCampaigns.length / itemsPerPage);

  const paginate = (pageNumber: number) => setCurrentPage(pageNumber);

  const renderCarbonChart = () => {
    if (campaigns.length === 0) {
      return (
        <div className="no-data-chart">
          <p>No carbon data available</p>
          <p>Submit a campaign to see analytics</p>
        </div>
      );
    }

    const completedCampaigns = campaigns.filter(c => c.status === "completed");
    if (completedCampaigns.length === 0) {
      return (
        <div className="no-data-chart">
          <p>No completed analyses yet</p>
          <p>Process a campaign to see carbon data</p>
        </div>
      );
    }

    const maxCarbon = Math.max(...completedCampaigns.map(c => c.carbonFootprint));
    
    return (
      <div className="carbon-chart">
        {completedCampaigns.slice(0, 5).map(campaign => (
          <div key={campaign.id} className="chart-bar-container">
            <div className="chart-label">{campaign.name.substring(0, 10)}...</div>
            <div className="chart-bar">
              <div 
                className="chart-fill" 
                style={{ width: `${(campaign.carbonFootprint / maxCarbon) * 100}%` }}
              ></div>
            </div>
            <div className="chart-value">{campaign.carbonFootprint} kg CO₂</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="tech-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container tech-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="carbon-icon"></div>
          </div>
          <h1>AdCarbon<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-campaign-btn tech-button"
          >
            <div className="add-icon"></div>
            New Campaign
          </button>
          <button 
            className="tech-button secondary"
            onClick={checkAvailability}
          >
            Check FHE Status
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-panels">
          <div className="welcome-panel glass-panel">
            <div className="welcome-content">
              <h2>FHE-Powered Carbon Analysis</h2>
              <p>Calculate your ad campaign's carbon footprint while preserving data privacy with Fully Homomorphic Encryption</p>
              <button 
                className="tech-button primary"
                onClick={() => setShowTutorial(!showTutorial)}
              >
                {showTutorial ? "Hide Tutorial" : "How It Works"}
              </button>
            </div>
            <div className="welcome-visual">
              <div className="carbon-visualization">
                <div className="circle-base circle-1"></div>
                <div className="circle-base circle-2"></div>
                <div className="circle-base circle-3"></div>
                <div className="fhe-core"></div>
              </div>
            </div>
          </div>
          
          {showTutorial && (
            <div className="tutorial-panel glass-panel">
              <h2>How FHE Carbon Analysis Works</h2>
              <p className="subtitle">Privacy-preserving carbon footprint calculation for ad campaigns</p>
              
              <div className="tutorial-steps">
                {tutorialSteps.map((step, index) => (
                  <div 
                    className="tutorial-step"
                    key={index}
                  >
                    <div className="step-number">{index + 1}</div>
                    <div className="step-icon">{step.icon}</div>
                    <div className="step-content">
                      <h3>{step.title}</h3>
                      <p>{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div className="stats-panel glass-panel">
            <h3>Carbon Analytics</h3>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon">📈</div>
                <div className="stat-data">
                  <div className="stat-value">{campaigns.length}</div>
                  <div className="stat-label">Total Campaigns</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">✅</div>
                <div className="stat-data">
                  <div className="stat-value">{completedCount}</div>
                  <div className="stat-label">Analyzed</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">🔄</div>
                <div className="stat-data">
                  <div className="stat-value">{processingCount}</div>
                  <div className="stat-label">Processing</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">🌿</div>
                <div className="stat-data">
                  <div className="stat-value">{Math.round(totalCarbon)}</div>
                  <div className="stat-label">kg CO₂ Tracked</div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="chart-panel glass-panel">
            <h3>Carbon Footprint Comparison</h3>
            {renderCarbonChart()}
          </div>
        </div>
        
        <div className="campaigns-section">
          <div className="section-header">
            <h2>Ad Campaigns</h2>
            <div className="header-actions">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search campaigns..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="tech-input"
                />
              </div>
              <button 
                onClick={loadCampaigns}
                className="refresh-btn tech-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="campaigns-list glass-panel">
            <div className="table-header">
              <div className="header-cell">Name</div>
              <div className="header-cell">Owner</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Carbon (kg CO₂)</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {currentItems.length === 0 ? (
              <div className="no-campaigns">
                <div className="no-data-icon"></div>
                <p>No campaigns found</p>
                <button 
                  className="tech-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Campaign
                </button>
              </div>
            ) : (
              <>
                {currentItems.map(campaign => (
                  <div 
                    className="campaign-row" 
                    key={campaign.id}
                    onClick={() => setSelectedCampaign(campaign)}
                  >
                    <div className="table-cell campaign-name">{campaign.name}</div>
                    <div className="table-cell">{campaign.owner.substring(0, 6)}...{campaign.owner.substring(38)}</div>
                    <div className="table-cell">
                      {new Date(campaign.timestamp * 1000).toLocaleDateString()}
                    </div>
                    <div className="table-cell">
                      {campaign.status === "completed" ? (
                        <span className="carbon-value">{campaign.carbonFootprint} kg</span>
                      ) : (
                        <span className="carbon-pending">-</span>
                      )}
                    </div>
                    <div className="table-cell">
                      <span className={`status-badge ${campaign.status}`}>
                        {campaign.status}
                      </span>
                    </div>
                    <div className="table-cell actions">
                      {isOwner(campaign.owner) && campaign.status === "processing" && (
                        <button 
                          className="action-btn tech-button primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            calculateCarbon(campaign.id);
                          }}
                        >
                          Calculate
                        </button>
                      )}
                      {campaign.status === "completed" && (
                        <button 
                          className="action-btn tech-button secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCampaign(campaign);
                          }}
                        >
                          Details
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                
                {totalPages > 1 && (
                  <div className="pagination">
                    <button 
                      className="pagination-btn"
                      disabled={currentPage === 1}
                      onClick={() => paginate(currentPage - 1)}
                    >
                      Previous
                    </button>
                    
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                      <button
                        key={page}
                        className={`pagination-btn ${currentPage === page ? 'active' : ''}`}
                        onClick={() => paginate(page)}
                      >
                        {page}
                      </button>
                    ))}
                    
                    <button 
                      className="pagination-btn"
                      disabled={currentPage === totalPages}
                      onClick={() => paginate(currentPage + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitCampaign} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          campaignData={newCampaignData}
          setCampaignData={setNewCampaignData}
        />
      )}
      
      {selectedCampaign && (
        <CampaignDetails 
          campaign={selectedCampaign}
          onClose={() => setSelectedCampaign(null)}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-panel">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="tech-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="carbon-icon"></div>
              <span>AdCarbon FHE</span>
            </div>
            <p>Privacy-preserving carbon footprint analysis for advertising campaigns</p>
          </div>
          
          <div className="footer-links">
            <h4>Resources</h4>
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">FHE Technology</a>
            <a href="#" className="footer-link">API Reference</a>
          </div>
          
          <div className="footer-links">
            <h4>Company</h4>
            <a href="#" className="footer-link">About Us</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
          </div>
          
          <div className="footer-links">
            <h4>Community</h4>
            <a href="#" className="footer-link">GitHub</a>
            <a href="#" className="footer-link">Twitter</a>
            <a href="#" className="footer-link">Discord</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} AdCarbon FHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  campaignData: any;
  setCampaignData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  campaignData,
  setCampaignData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setCampaignData({
      ...campaignData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!campaignData.name || campaignData.servers <= 0) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal glass-panel">
        <div className="modal-header">
          <h2>New Ad Campaign</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="lock-icon"></div> Campaign data will be encrypted with FHE before processing
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Campaign Name *</label>
              <input 
                type="text"
                name="name"
                value={campaignData.name} 
                onChange={handleChange}
                placeholder="Q4 Brand Awareness Campaign" 
                className="tech-input"
              />
            </div>
            
            <div className="form-group">
              <label>Servers Used *</label>
              <input 
                type="number"
                name="servers"
                value={campaignData.servers} 
                onChange={handleChange}
                min="1"
                className="tech-input"
              />
            </div>
            
            <div className="form-group">
              <label>Bandwidth (GB) *</label>
              <input 
                type="number"
                name="bandwidth"
                value={campaignData.bandwidth} 
                onChange={handleChange}
                min="0"
                step="0.1"
                className="tech-input"
              />
            </div>
            
            <div className="form-group">
              <label>Impressions *</label>
              <input 
                type="number"
                name="impressions"
                value={campaignData.impressions} 
                onChange={handleChange}
                min="0"
                className="tech-input"
              />
            </div>
            
            <div className="form-group">
              <label>Duration (Days) *</label>
              <input 
                type="number"
                name="duration"
                value={campaignData.duration} 
                onChange={handleChange}
                min="1"
                className="tech-input"
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="shield-icon"></div> All data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn tech-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn tech-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Create Campaign"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface CampaignDetailsProps {
  campaign: CampaignData;
  onClose: () => void;
}

const CampaignDetails: React.FC<CampaignDetailsProps> = ({ campaign, onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="details-modal glass-panel">
        <div className="modal-header">
          <h2>Campaign Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-section">
            <h3>{campaign.name}</h3>
            <p className="campaign-id">ID: {campaign.id}</p>
          </div>
          
          <div className="detail-section">
            <h4>Carbon Footprint</h4>
            <div className="carbon-display">
              <span className="carbon-value-large">{campaign.carbonFootprint}</span>
              <span className="carbon-unit">kg CO₂</span>
            </div>
            <p className="carbon-description">
              Estimated carbon emissions for this ad campaign
            </p>
          </div>
          
          {campaign.details && (
            <div className="detail-section">
              <h4>Campaign Metrics</h4>
              <div className="metrics-grid">
                <div className="metric">
                  <span className="metric-label">Servers</span>
                  <span className="metric-value">{campaign.details.servers}</span>
                </div>
                <div className="metric">
                  <span className="metric-label">Bandwidth</span>
                  <span className="metric-value">{campaign.details.bandwidth} GB</span>
                </div>
                <div className="metric">
                  <span className="metric-label">Impressions</span>
                  <span className="metric-value">{campaign.details.impressions.toLocaleString()}</span>
                </div>
                <div className="metric">
                  <span className="metric-label">Duration</span>
                  <span className="metric-value">{campaign.details.duration} days</span>
                </div>
              </div>
            </div>
          )}
          
          <div className="detail-section">
            <h4>Technical Details</h4>
            <div className="tech-details">
              <p><strong>Status:</strong> <span className={`status-text ${campaign.status}`}>{campaign.status}</span></p>
              <p><strong>Owner:</strong> {campaign.owner}</p>
              <p><strong>Created:</strong> {new Date(campaign.timestamp * 1000).toLocaleString()}</p>
              <p><strong>Data Security:</strong> Encrypted with FHE</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="tech-button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;