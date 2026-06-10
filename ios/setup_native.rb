#!/usr/bin/env ruby
# Adds all new native Swift files to the Xcode project
# Run from: ruby ios/setup_native.rb

require 'xcodeproj'

PROJECT_PATH = File.join(__dir__, 'App/App.xcodeproj')
APP_DIR      = File.join(__dir__, 'App/App')

NEW_FILES = %w[
  Config.swift
  Models.swift
  Theme.swift
  AppState.swift
  SupabaseService.swift
  NotificationManager.swift
  TheSparkApp.swift
  ContentView.swift
  AuthContainerView.swift
  LoginView.swift
  SignupView.swift
  MainTabView.swift
  FeedView.swift
  PostCardView.swift
  CreatePostView.swift
  ProfileView.swift
  OtherProfileView.swift
  EditProfileView.swift
  SearchView.swift
  DMListView.swift
  DMConversationView.swift
  NotificationsView.swift
  StatsView.swift
  TunesPickerView.swift
  TunesPageView.swift
  GamesView.swift
  DiscoverPeopleView.swift
  ContactView.swift
  AccountSwitcherView.swift
]

# Files to REMOVE from the project (Capacitor leftovers)
REMOVE_FILES = %w[Main.storyboard public capacitor.config.json config.xml]

project = Xcodeproj::Project.open(PROJECT_PATH)
target  = project.targets.first
group   = project.main_group.find_subpath('App', true)

# Remove old Capacitor files/groups from project
REMOVE_FILES.each do |name|
  ref = group.find_file_by_path(name)
  if ref
    target.resources_build_phase.remove_file_reference(ref) rescue nil
    target.source_files_build_phase rescue nil
    ref.remove_from_project
    puts "  Removed: #{name}"
  end
end

# Remove Capacitor from Frameworks build phase
frameworks_phase = target.frameworks_build_phase
frameworks_phase.files.each do |f|
  if f.display_name&.downcase&.include?('pods') || f.display_name&.downcase&.include?('capacitor')
    frameworks_phase.remove_build_file(f)
    puts "  Removed framework: #{f.display_name}"
  end
end

# Remove Pods xcconfig references
project.build_configurations.each do |config|
  config.base_configuration_reference = nil
end

# Add new Swift files
sources_phase = target.source_build_phase

NEW_FILES.each do |filename|
  # Skip if already in project
  existing = group.files.find { |f| f.path == filename }
  if existing
    puts "  Already exists: #{filename}"
    next
  end

  # Check file actually exists on disk
  full_path = File.join(APP_DIR, filename)
  unless File.exist?(full_path)
    puts "  WARNING: File not found on disk: #{filename}"
    next
  end

  file_ref = group.new_reference(filename)
  file_ref.last_known_file_type = 'sourcecode.swift'
  sources_phase.add_file_reference(file_ref)
  puts "  Added: #{filename}"
end

# Update AppDelegate — make sure it's still in sources (we rewrote it, not added new)
appdelegate = group.files.find { |f| f.path == 'AppDelegate.swift' }
if appdelegate && !sources_phase.files_references.include?(appdelegate)
  sources_phase.add_file_reference(appdelegate)
end

# Remove @UIApplicationMain from the old AppDelegate (it now uses @main in TheSparkApp.swift)
# (Already handled by our rewrite of AppDelegate.swift)

# Set deployment target to iOS 15
target.build_configurations.each do |config|
  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.0'
  config.build_settings['SWIFT_VERSION'] = '5.9'
  # Remove storyboard references
  config.build_settings.delete('INFOPLIST_KEY_UIMainStoryboardFile')
end

project.save
puts "\n✅  Project updated! Now run:"
puts "   cd ios/App && pod install"
puts "   Then open App.xcworkspace in Xcode"
