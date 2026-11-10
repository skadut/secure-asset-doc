-- Reference data: NIST CSF 2.0 subcategories (was in init/001_schema.sql) and ranks (was in init/006_rbac.sql).
-- Idempotent: ON CONFLICT DO NOTHING.
BEGIN;

INSERT INTO csf_subcategories (id, fn, category, category_name, outcome) VALUES
('GV.OC-01', 'GV', 'GV.OC', 'Organizational Context', 'The organizational mission is understood and informs cybersecurity risk management'),
('GV.RM-01', 'GV', 'GV.RM', 'Risk Management Strategy', 'Risk management objectives are established and agreed to by organizational stakeholders'),
('GV.RR-02', 'GV', 'GV.RR', 'Roles, Responsibilities, and Authorities', 'Roles, responsibilities, and authorities related to cybersecurity risk management are established, communicated, understood, and enforced'),
('GV.PO-01', 'GV', 'GV.PO', 'Policy', 'Policy for managing cybersecurity risks is established based on organizational context, cybersecurity strategy, and priorities and is communicated and enforced'),
('GV.SC-07', 'GV', 'GV.SC', 'Cybersecurity Supply Chain Risk Management', 'The risks posed by a supplier, their products and services, and other third parties are understood, recorded, prioritized, assessed, responded to, and monitored over the course of the relationship'),
('ID.AM-01', 'ID', 'ID.AM', 'Asset Management', 'Inventories of hardware managed by the organization are maintained'),
('ID.AM-02', 'ID', 'ID.AM', 'Asset Management', 'Inventories of software, services, and systems managed by the organization are maintained'),
('ID.AM-03', 'ID', 'ID.AM', 'Asset Management', 'Representations of the organization''s authorized network communication and internal and external network data flows are maintained'),
('ID.RA-01', 'ID', 'ID.RA', 'Risk Assessment', 'Vulnerabilities in assets are identified, validated, and recorded'),
('ID.RA-05', 'ID', 'ID.RA', 'Risk Assessment', 'Threats, vulnerabilities, likelihoods, and impacts are used to understand inherent risk and inform risk response prioritization'),
('PR.AA-01', 'PR', 'PR.AA', 'Identity Management, Authentication, and Access Control', 'Identities and credentials for authorized users, services, and hardware are managed by the organization'),
('PR.AA-05', 'PR', 'PR.AA', 'Identity Management, Authentication, and Access Control', 'Access permissions, entitlements, and authorizations are defined in a policy, managed, enforced, and reviewed, and incorporate the principles of least privilege and separation of duties'),
('PR.DS-01', 'PR', 'PR.DS', 'Data Security', 'The confidentiality, integrity, and availability of data-at-rest are protected'),
('PR.PS-01', 'PR', 'PR.PS', 'Platform Security', 'Configuration management practices are established and applied'),
('PR.IR-01', 'PR', 'PR.IR', 'Technology Infrastructure Resilience', 'Networks and environments are protected from unauthorized logical access and usage'),
('DE.CM-01', 'DE', 'DE.CM', 'Continuous Monitoring', 'Networks and network services are monitored to find potentially adverse events'),
('DE.AE-02', 'DE', 'DE.AE', 'Adverse Event Analysis', 'Potentially adverse events are analyzed to better understand associated activities'),
('RS.MA-01', 'RS', 'RS.MA', 'Incident Management', 'The incident response plan is executed in coordination with relevant third parties once an incident is declared'),
('RS.CO-02', 'RS', 'RS.CO', 'Incident Response Reporting and Communication', 'Internal and external stakeholders are notified of incidents'),
('RC.RP-01', 'RC', 'RC.RP', 'Incident Recovery Plan Execution', 'The recovery portion of the incident response plan is executed once initiated from the incident response process'),
('RC.CO-03', 'RC', 'RC.CO', 'Incident Recovery Communication', 'Recovery activities and progress in restoring operational capabilities are communicated to designated internal and external stakeholders')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ranks (code, name, golongan, tlp_max, sort) VALUES
('jenderal-tni', 'Jenderal TNI', 'PATI', 'RED', 1),
('letnan-jenderal-tni', 'Letnan Jenderal TNI', 'PATI', 'RED', 2),
('mayor-jenderal-tni', 'Mayor Jenderal TNI', 'PATI', 'RED', 3),
('brigadir-jenderal-tni', 'Brigadir Jenderal TNI', 'PATI', 'RED', 4),
('kolonel', 'Kolonel', 'PAMEN', 'AMBER+STRICT', 5),
('letnan-kolonel', 'Letnan Kolonel', 'PAMEN', 'AMBER+STRICT', 6),
('mayor', 'Mayor', 'PAMEN', 'AMBER+STRICT', 7),
('kapten', 'Kapten', 'PAMA', 'AMBER', 8),
('letnan-satu', 'Letnan Satu', 'PAMA', 'AMBER', 9),
('letnan-dua', 'Letnan Dua', 'PAMA', 'AMBER', 10),
('pembantu-letnan-satu', 'Pembantu Letnan Satu', 'Bintara Tinggi', 'GREEN', 11),
('pembantu-letnan-dua', 'Pembantu Letnan Dua', 'Bintara Tinggi', 'GREEN', 12),
('sersan-mayor', 'Sersan Mayor', 'Bintara', 'CLEAR', 13),
('sersan-kepala', 'Sersan Kepala', 'Bintara', 'CLEAR', 14),
('sersan-satu', 'Sersan Satu', 'Bintara', 'CLEAR', 15),
('sersan-dua', 'Sersan Dua', 'Bintara', 'CLEAR', 16),
('kopral-kepala', 'Kopral Kepala', 'Tamtama Kepala', 'CLEAR', 17),
('kopral-satu', 'Kopral Satu', 'Tamtama Kepala', 'CLEAR', 18),
('kopral-dua', 'Kopral Dua', 'Tamtama Kepala', 'CLEAR', 19),
('prajurit-kepala', 'Prajurit Kepala', 'Tamtama', 'CLEAR', 20),
('prajurit-satu', 'Prajurit Satu', 'Tamtama', 'CLEAR', 21),
('prajurit-dua', 'Prajurit Dua', 'Tamtama', 'CLEAR', 22)
ON CONFLICT (code) DO NOTHING;

COMMIT;
