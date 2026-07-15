import React, { useState, useEffect } from "react";
import { LayoutDashboard, Plus, Sparkles, ClipboardList } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { updateCustomer } from "./frontend/api/customerApi";
import { fetchDashboardData } from "./frontend/api/dashboardApi";
import { createLead, updateLead, updateServiceRequest, createServiceRequest } from "./frontend/api/serviceRequestApi";
import { AppBoundary } from "./frontend/components/AppBoundary";
import { AppLayout } from "./frontend/components/AppLayout";
import { EditModal } from "./frontend/components/EditModal";
import { Header } from "./frontend/components/Header";
import { Modal } from "./frontend/components/Modal";
import { NotificationToast } from "./frontend/components/NotificationToast";
import { Sidebar } from "./frontend/components/Sidebar";
import { IMPLEMENTATION_TYPES, LEAD_STATUSES, PAYMENT_OPTIONS, REGIONS, REQUESTED_PEOPLE, SALES_PEOPLE, SALES_TYPES, SOURCES, TICKET_STATUSES, LEVEL_1_ASSIGNEES } from "./frontend/constants/options";
import { AiPage } from "./frontend/pages/AiPage";
import { DashboardPage } from "./frontend/pages/DashboardPage";
import { AddServicePage } from "./frontend/pages/AddServicePage";
import { LoginPage } from "./frontend/pages/LoginPage";
import { CustomersPage } from "./frontend/pages/CustomersPage";
import type { Customer, Registration, ServiceTicket } from "./frontend/types";
import { isValidStoredUser } from "./frontend/utils/auth";

function findOptionMatch(value: any, list: string[], defaultValue?: string): string {
  if (value === undefined || value === null || value === "") return defaultValue !== undefined ? defaultValue : list[0];
  const stringValue = String(value);
  const cleanedVal = stringValue.trim().toUpperCase().replace(/\s*\+\s*/g, "+").replace(/\s+/g, "");
  const normalize = (option: string) => option.trim().toUpperCase().replace(/\s*\+\s*/g, "+").replace(/\s+/g, "");
  const exact = list.find(opt => normalize(opt) === cleanedVal);
  if (exact) return exact;

  const found = list.find(opt => {
    const cleanedOpt = normalize(opt);
    return cleanedOpt.startsWith(cleanedVal) || cleanedOpt.includes(cleanedVal);
  });
  return found || defaultValue || list[0];
}
export default function App() {
  const [user, setUser] = useState<{ name: string; role: string; token: string } | null>(() => {
    try {
      const saved = localStorage.getItem("synohub-user");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (isValidStoredUser(parsed)) {
          return parsed;
        } else {
          localStorage.removeItem("synohub-user");
        }
      }
    } catch (e) {
      try {
        localStorage.removeItem("synohub-user");
      } catch (err) {}
    }
    return null;
  });

  const [activeTab, setActiveTab ] = useState<string>("overview");

  const [requestedPeopleList, setRequestedPeopleList] = useState<string[]>(REQUESTED_PEOPLE);
  const [defaultRequestedPerson, setDefaultRequestedPerson] = useState<string>("");
  const [pendingStaffName, setPendingStaffName] = useState<string | null>(null);
  const [prefilledChatPrompt, setPrefilledChatPrompt] = useState("");
  const [data, setData] = useState<{ registrations: Registration[], services: ServiceTicket[], customers: Customer[] }>({ 
    registrations: [], services: [], customers: [] 
  });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRegion, setFilterRegion] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");

  const [showAllFeed, setShowAllFeed] = useState(false);

  // Data Manager States
  const [dbTab, setDbTab] = useState<"leads" | "services" | "customers">("leads");
  const [dbSearch, setDbSearch] = useState("");
  const [dbRegion, setDbRegion] = useState("All");
  const [editingItem, setEditingItem] = useState<{ type: 'lead' | 'service' | 'customer', data: any } | null>(null);
  const [preselectedCustomer, setPreselectedCustomer] = useState<Customer | null>(null);
  
  // Custom states for existing lead select and visual notifications
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [dbError, setDbError] = useState<{ error: string; details?: string; connectionConfig?: any } | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4500);
  };

  const [leadForm, setLeadForm] = useState<Partial<Registration>>({
    status: 'New Lead',
    region: REGIONS[0],
    implementationType: IMPLEMENTATION_TYPES[0],
    salesPerson: SALES_PEOPLE[0],
    salesType: SALES_TYPES[0],
    source: SOURCES[0],
    newQty: 0,
    migrateQty: 0,
    tradingQty: 0,
    serviceQty: 0,
    otherQty: 0,
    customerName: "",
    contactName: "",
    phone: "",
    email: "",
    designation: "",
    address: "",
    mapLink: "",
    coordinates: "",
    comment: "",
    projectValue: "",
    priceDetails: "",
    accessories: "",
    requestedPerson: defaultRequestedPerson
  });

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showExistingSuggestions, setShowExistingSuggestions] = useState(false);

  // Clear lead form state to pristine defaults
  const resetLeadForm = () => {
    setLeadForm({
      status: 'New Lead',
      region: REGIONS[0],
      implementationType: IMPLEMENTATION_TYPES[0],
      salesPerson: SALES_PEOPLE[0],
      salesType: SALES_TYPES[0],
      source: SOURCES[0],
      newQty: 0,
      migrateQty: 0,
      tradingQty: 0,
      serviceQty: 0,
      otherQty: 0,
      customerName: "",
      contactName: "",
      phone: "",
      email: "",
      designation: "",
      address: "",
      mapLink: "",
      coordinates: "",
      comment: "",
      projectValue: "",
      priceDetails: "",
      accessories: "",
      requestedPerson: defaultRequestedPerson
    });
    setSelectedLeadId(null);
    setShowSuggestions(false);
  };

  // Synchronize authenticated user credentials to form defaults
  useEffect(() => {
    if (user) {
      if (user.role === "staff" || user.role === "admin") {
        setDefaultRequestedPerson(user.name);
        setLeadForm(prev => ({ ...prev, requestedPerson: user.name }));
      } else {
        setDefaultRequestedPerson("");
        setLeadForm(prev => ({ ...prev, requestedPerson: "" }));
      }
    }
  }, [user]);

  useEffect(() => {
    const handleAuthExpired = () => {
      setUser(null);
      setActiveTab("overview");
      setLoading(false);
    };
    window.addEventListener("synohub-auth-expired", handleAuthExpired);
    return () => window.removeEventListener("synohub-auth-expired", handleAuthExpired);
  }, []);

  // Safe reset when tab is switched
  useEffect(() => {
    if (activeTab === "new-form") {
      resetLeadForm();
    } else if (activeTab === "existing-form") {
      if (!selectedLeadId) {
        resetLeadForm();
      }
    }
  }, [activeTab]);

  // Sync leadForm with selectedLeadId from DB registrations dynamically
  useEffect(() => {
    if (selectedLeadId && data?.registrations && data.registrations.length > 0) {
      const selectedReg = data.registrations.find(r => r.id === selectedLeadId);
      if (selectedReg) {
        setLeadForm({
          status: findOptionMatch(selectedReg.status, LEAD_STATUSES, "New Lead"),
          region: findOptionMatch(selectedReg.region, REGIONS, REGIONS[0]),
          implementationType: findOptionMatch(selectedReg.implementationType, IMPLEMENTATION_TYPES, IMPLEMENTATION_TYPES[0]),
          salesPerson: findOptionMatch(selectedReg.salesPerson, SALES_PEOPLE, SALES_PEOPLE[0]),
          salesType: findOptionMatch(selectedReg.salesType, SALES_TYPES, SALES_TYPES[0]),
          source: findOptionMatch(selectedReg.source, SOURCES, SOURCES[0]),
          newQty: selectedReg.newQty || 0,
          migrateQty: selectedReg.migrateQty || 0,
          tradingQty: selectedReg.tradingQty || 0,
          serviceQty: selectedReg.serviceQty || 0,
          otherQty: selectedReg.otherQty || 0,
          customerName: selectedReg.customerName || "",
          contactName: selectedReg.contactName || "",
          phone: selectedReg.phone || "",
          email: selectedReg.email || "",
          designation: selectedReg.designation || "",
          address: selectedReg.address || "",
          mapLink: selectedReg.mapLink || "",
          coordinates: selectedReg.coordinates || "",
          comment: selectedReg.comment || "",
          projectValue: selectedReg.projectValue || "",
          priceDetails: selectedReg.priceDetails || "",
          accessories: selectedReg.accessories || "",
          requestedPerson: findOptionMatch(selectedReg.requestedPerson, requestedPeopleList, "")
        });
      }
    }
  }, [selectedLeadId, data.registrations, requestedPeopleList]);

  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (activeTab === "existing-form" && selectedLeadId) {
        // Update database with existing lead record
        await updateLead(selectedLeadId, leadForm);
        showToast("Lead configuration updated in database and synchronized with Customers successfully!");
      } else {
        // Create brand-new lead registration in database
        await createLead(leadForm);
        showToast("Lead registration created in database and synchronized with Customers successfully!");
      }

      fetchData();
      resetLeadForm();
    } catch (err) {
      console.error("Submit error details:", err);
      const message = err instanceof Error ? err.message : "Could not submit lead details. Please inspect constraints and connection.";
      showToast(message, "error");
    }
  };

  const handleSelectCustomer = (cust: Customer) => {
    if (activeTab === "new-form") {
      setLeadForm(prev => ({
        ...prev,
        customerName: cust.name,
        contactName: cust.contactName || prev.contactName || "",
        phone: cust.phone || prev.phone || "",
        email: cust.email || prev.email || "",
        region: cust.region || prev.region || REGIONS[0],
        implementationType: cust.implementationType || prev.implementationType || IMPLEMENTATION_TYPES[0]
      }));
      showToast(`Populated "New Form" with details for: ${cust.name}`);
    } else if (activeTab === "existing-form") {
      const matchingReg = (data?.registrations || []).find(r => r && r.customerName && cust?.name && (r.customerName || '').toLowerCase() === (cust.name || '').toLowerCase());
      if (matchingReg) {
        setSelectedLeadId(matchingReg.id);
        showToast(`Loaded existing Lead ID #${matchingReg.id} for: ${cust.name}`);
      } else {
        setSelectedLeadId(null);
        setLeadForm(prev => ({
          ...prev,
          customerName: cust.name,
          contactName: cust.contactName || "",
          phone: cust.phone || "",
          email: cust.email || "",
          region: cust.region || REGIONS[0],
          implementationType: cust.implementationType || IMPLEMENTATION_TYPES[0],
          source: "Company Lead",
          status: "New Lead",
          requestedPerson: defaultRequestedPerson,
          salesType: "New"
        }));
        showToast(`No lead found. Ready to create a new lead for customer: ${cust.name}`);
      }
    }
  };

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [user?.token]);

  const fetchData = async () => {
    try {
      const res: any = await fetchDashboardData();
      setData({
        registrations: res && Array.isArray(res.registrations) ? res.registrations : [],
        services: res && Array.isArray(res.services) ? res.services : [],
        customers: res && Array.isArray(res.customers) ? res.customers : []
      });
      setDbError(null);

      // Extract dynamic requestedPerson and append to listed people if missing
      const dbRequestedPeople = new Set<string>();
      if (res?.registrations && Array.isArray(res.registrations)) {
        res.registrations.forEach((r: any) => {
          if (r?.requestedPerson) {
            const trimmed = String(r.requestedPerson).trim();
            if (trimmed) dbRequestedPeople.add(trimmed);
          }
        });
      }
      if (res?.services && Array.isArray(res.services)) {
        res.services.forEach((s: any) => {
          if (s?.requestedPerson) {
            const trimmed = String(s.requestedPerson).trim();
            if (trimmed) dbRequestedPeople.add(trimmed);
          }
        });
      }

      if (dbRequestedPeople.size > 0) {
        setRequestedPeopleList(prev => {
          const merged = [...prev];
          dbRequestedPeople.forEach(person => {
            const trimmed = person.trim();
            const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
            if (capitalized && !merged.some(p => (p || '').toLowerCase() === capitalized.toLowerCase())) {
              merged.push(capitalized);
            }
          });
          return merged;
        });
      }
    } catch (e: any) {
      console.error("Data fetch failed", e);
      if (e.response && e.response.data) {
        setDbError(e.response.data);
      } else {
        setDbError({ 
          error: e.message || "Unknown database connection error",
          details: "Could not reach database API endpoint." 
        });
      }
      // Keep existing data on transient background errors instead of wiping the UI
      setData(prev => {
        if (prev.registrations.length > 0 || prev.services.length > 0 || prev.customers.length > 0) {
          return prev;
        }
        return {
          registrations: [],
          services: [],
          customers: []
        };
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredRegistrations = (data?.registrations || []).filter(reg => {
    if (!reg) return false;
    const matchesSearch = ((reg.customerName || '').toLowerCase()).includes((searchTerm || '').toLowerCase()) || 
                          ((reg.contactName || '').toLowerCase()).includes((searchTerm || '').toLowerCase());
    const matchesRegion = filterRegion === "All" || reg.region === filterRegion;
    const matchesStatus = filterStatus === "All" || reg.status === filterStatus;
    return matchesSearch && matchesRegion && matchesStatus;
  });

  const filteredServices = (data?.services || []).filter(svc => {
    if (!svc) return false;
    const matchesSearch = ((svc.customerName || '').toLowerCase()).includes((searchTerm || '').toLowerCase()) || 
                          ((svc.ticketId || '').toLowerCase()).includes((searchTerm || '').toLowerCase());
    const matchesStatus = filterStatus === "All" || svc.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const filteredCustomers = (data?.customers || []).filter(cust => 
    cust && cust.name && ((cust.name || '').toLowerCase()).includes((searchTerm || '').toLowerCase())
  );


  const navItems = [
    { id: "overview", label: "Dashboard", icon: LayoutDashboard },
    { id: "add-service", label: "Add Service", icon: Plus },
    { id: "ai", label: "SynoAI Chat", icon: Sparkles },
  ].filter(item => !!user);

  if (!user) {
    return (
      <LoginPage
        onLoginSuccess={(loggedUser) => {
          localStorage.setItem("synohub-user", JSON.stringify(loggedUser));
          setUser(loggedUser);
          setActiveTab("overview");
          showToast(`Welcome back, ${loggedUser.name}!`);
        }} 
      />
    );
  }

  const handleLoginSuccessRecovery = (loggedUser: any) => {
    if (!isValidStoredUser(loggedUser)) {
      try {
        localStorage.removeItem("synohub-user");
      } catch (e) {}
      setUser(null);
      return;
    }
    try {
      localStorage.setItem("synohub-user", JSON.stringify(loggedUser));
    } catch (e) {}
    setUser(loggedUser);
    window.location.reload();
  };

  const errorFallback = (
    <LoginPage
      onLoginSuccess={handleLoginSuccessRecovery}
    />
  );

  return (
    <AppBoundary fallback={errorFallback}>
      <AppLayout
        notification={
          <NotificationToast
            notification={notification}
            onClose={() => setNotification(null)}
          />
        }
        sidebar={
          <Sidebar
            activeTab={activeTab}
            navItems={navItems}
            user={user}
            onNavigate={(tabId) => {
              setActiveTab(tabId);
              setFilterStatus("All");
              setFilterRegion("All");
            }}
            onLogout={() => {
              localStorage.removeItem("synohub-user");
              setUser(null);
              showToast("Signed out successfully");
            }}
          />
        }
        header={
          <Header
            activeTab={activeTab}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
          />
        }
      >
          <AnimatePresence mode="wait">


            {searchTerm.trim() !== "" ? (
              <div className="bg-[#F8FAFC] min-h-screen p-8">
                <CustomersPage
                  searchTerm={searchTerm}
                  customers={filteredCustomers}
                  registrations={data?.registrations || []}
                  actionLabel="Select Customer"
                  onSelectCustomer={(cust) => {
                    setPreselectedCustomer(cust);
                    setSearchTerm("");
                    setActiveTab("add-service");
                  }}
                />
              </div>
            ) : (
              <>
                {activeTab === "overview" && (
                  <DashboardPage
                    registrations={data?.registrations || []}
                    showAllFeed={showAllFeed}
                    onSelectLead={(leadId) => {
                      const selectedReg = data.registrations.find(r => r.id === leadId);
                      if (selectedReg) {
                        setEditingItem({ type: 'lead', data: selectedReg });
                      }
                    }}
                    onToggleShowAllFeed={() => setShowAllFeed(!showAllFeed)}
                  />
                )}

                {activeTab === "add-service" && (
                  <AddServicePage
                    customers={data?.customers || []}
                    level1Assignees={LEVEL_1_ASSIGNEES}
                    requestedPeopleList={requestedPeopleList}
                    preselectedCustomer={preselectedCustomer}
                    onClearPreselected={() => setPreselectedCustomer(null)}
                    onSubmit={async (payload) => {
                      try {
                        await createServiceRequest(payload);
                        showToast("Service ticket created successfully!");
                        setActiveTab("overview");
                        fetchData();
                      } catch (err: any) {
                        const message = err.response?.data?.error || err.message || "Failed to create service ticket";
                        showToast(message, "error");
                      }
                    }}
                    onClose={() => setActiveTab("overview")}
                  />
                )}

                {activeTab === "ai" && (
                  <AiPage
                    user={user}
                    staffOptions={requestedPeopleList}
                    forcedInput={prefilledChatPrompt}
                    onInputLoaded={() => setPrefilledChatPrompt("")}
                    onRecordSaved={(savedRecord) => {
                        fetchData();
                      if (savedRecord && savedRecord.type === "service") {
                        showToast(`AI Auto-Saved: Service Ticket for "${savedRecord.customerName}" logged!`, "success");
                      }
                    }}
                  />
                )}
              </>
            )}


          </AnimatePresence>
      </AppLayout>

      {/* Visual Edit Modal */}
      {editingItem && (
        <EditModal
          editingItem={editingItem}
          setEditingItem={setEditingItem}
          userRole={user?.role}
          onSubmit={async (e) => {
            e.preventDefault();
            if (user?.role !== "admin") return;
            try {
              if (editingItem.type === 'lead') {
                await updateLead(editingItem.data.id, editingItem.data);
              } else if (editingItem.type === 'service') {
                await updateServiceRequest(editingItem.data.id, editingItem.data);
              } else {
                await updateCustomer(editingItem.data.id, editingItem.data);
              }
              setEditingItem(null);
              fetchData();
            } catch (err: any) {
              alert("Failed to update: " + err.message);
            }
          }}
          regions={REGIONS}
          leadStatuses={LEAD_STATUSES}
          implementationTypes={IMPLEMENTATION_TYPES}
          salesPeople={SALES_PEOPLE}
          ticketStatuses={TICKET_STATUSES}
          paymentOptions={PAYMENT_OPTIONS}
        />
      )}



  </AppBoundary>
  );
}
