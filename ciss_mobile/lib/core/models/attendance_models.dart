class ShiftTemplateModel {
  const ShiftTemplateModel({
    required this.code,
    required this.label,
    required this.startTime,
    required this.endTime,
  });

  final String code;
  final String label;
  final String startTime;
  final String endTime;
}

class DutyPointModel {
  const DutyPointModel({
    required this.id,
    required this.name,
    required this.coverageMode,
    required this.dutyHours,
    this.shiftTemplates = const <ShiftTemplateModel>[],
  });

  final String id;
  final String name;
  final String coverageMode;
  final String dutyHours;
  final List<ShiftTemplateModel> shiftTemplates;
}

class SiteOptionModel {
  const SiteOptionModel({
    required this.id,
    required this.siteName,
    required this.clientName,
    required this.district,
    this.dutyPoints = const <DutyPointModel>[],
  });

  final String id;
  final String siteName;
  final String clientName;
  final String district;
  final List<DutyPointModel> dutyPoints;
}

class AttendanceRecordModel {
  const AttendanceRecordModel({
    required this.siteName,
    required this.dateLabel,
    required this.status,
    required this.dutyPointName,
    required this.shiftLabel,
  });

  final String siteName;
  final String dateLabel;
  final String status;
  final String dutyPointName;
  final String shiftLabel;
}

